import { supabase, supabaseAdmin, isSupabaseConfigured } from '../lib/supabase';
import { AppStorage } from '../lib/storage';
import { calculateSettlement } from './settle';
import { FriendContact, normalizePhone, getContactNameByPhone, getEffectiveContactName, isGenericPlaceholder } from '../features/contacts/useContactsStore';
import { Trip, TripMember, Expense, ExpenseSplit } from '../types/database';
import { computeBalances, normalizeExpensesForTrip } from '../features/trips/useTripStore';

export interface FriendsApiResult {
  totalOwedToYouPaise: number;
  totalYouOwePaise: number;
  netOverallPaise: number;
  friends: FriendContact[];
}

/**
 * Dedicated database-driven Friends API.
 * Accurately calculates total owed/owe across ALL friends in database (not just the paginated 10-20),
 * and returns the full list of friends with pending settlements sorted to the very top.
 */
export async function fetchFriendsSummaryApi(userId: string): Promise<FriendsApiResult> {
  const cacheKey = `@splityourtrip_friends_summary_${userId}`;

  // 1. Check local cache first for instant UI response
  let cachedResult: FriendsApiResult | null = null;
  try {
    const rawCache = await AppStorage.getItem(cacheKey);
    if (rawCache) {
      cachedResult = JSON.parse(rawCache);
    }
  } catch {}

  if (!userId) {
    return cachedResult || { totalOwedToYouPaise: 0, totalYouOwePaise: 0, netOverallPaise: 0, friends: [] };
  }

  try {
    const sb = supabaseAdmin || supabase;

    // 2. Fetch all trips where user is creator, friend, or a member, or sent chat messages
    const [memberTripsRes, createdTripsRes, friendTripsRes, messageTripsRes] = await Promise.all([
      sb
        .from('trip_members')
        .select('trip_id, id, profile_id, display_name, phone_number')
        .or(`profile_id.eq.${userId},user_id.eq.${userId}`),
      sb.from('trips').select('id, name, trip_type, friend_id, created_by').eq('created_by', userId),
      sb.from('trips').select('id, name, trip_type, friend_id, created_by').eq('friend_id', userId),
      sb.from('trip_messages').select('trip_id').eq('sender_id', userId).limit(100),
    ]);

    // Also collect local trip IDs from storage to include offline/local trips
    let localTrips: Trip[] = [];
    try {
      const rawLocal = await AppStorage.getItem(`@splityourtrip_local_trips_${userId}`);
      if (rawLocal) localTrips = JSON.parse(rawLocal);
    } catch {}

    const tripIds = Array.from(
      new Set([
        ...(memberTripsRes.data || []).map((r: any) => r.trip_id),
        ...(createdTripsRes.data || []).map((r: any) => r.id),
        ...(friendTripsRes.data || []).map((r: any) => r.id),
        ...(messageTripsRes.data || []).map((r: any) => r.trip_id),
        ...localTrips.map(t => t.id),
      ])
    ).filter(Boolean);

    if (tripIds.length === 0) {
      const emptyResult: FriendsApiResult = {
        totalOwedToYouPaise: 0,
        totalYouOwePaise: 0,
        netOverallPaise: 0,
        friends: [],
      };
      await AppStorage.setItem(cacheKey, JSON.stringify(emptyResult)).catch(() => {});
      return emptyResult;
    }

    // 3. Concurrently fetch all trips metadata, members, and expenses for these trips
    const [allTripsRes, allMembersRes, allExpensesRes] = await Promise.all([
      sb.from('trips').select('id, name, trip_type, friend_id, created_by').in('id', tripIds),
      sb.from('trip_members').select('*').in('trip_id', tripIds),
      sb.from('expenses').select('*').in('trip_id', tripIds),
    ]);

    const remoteTrips = allTripsRes.data || [];
    const remoteMembers = allMembersRes.data || [];
    const remoteExpenses = allExpensesRes.data || [];
    const expIds = remoteExpenses.map((e: any) => e.id);

    const splitsRes = expIds.length > 0
      ? await sb.from('expense_splits').select('*').in('expense_id', expIds)
      : { data: [] };
    const allSplits = splitsRes.data || [];

    // Map trips for lookup
    const allTripsMap = new Map<string, any>();
    remoteTrips.forEach((t: any) => allTripsMap.set(t.id, t));
    localTrips.forEach(t => allTripsMap.set(t.id, t));

    // Collect all profile IDs to fetch real profiles (avatar, full name, phone)
    const allProfileIds = new Set<string>();
    remoteMembers.forEach((m: any) => {
      if (m.profile_id && m.profile_id !== userId) allProfileIds.add(m.profile_id);
      if (m.user_id && m.user_id !== userId) allProfileIds.add(m.user_id);
    });
    remoteTrips.forEach((t: any) => {
      if (t.friend_id && t.friend_id !== userId) allProfileIds.add(t.friend_id);
      if (t.created_by && t.created_by !== userId) allProfileIds.add(t.created_by);
    });

    const profilesMap = new Map<string, any>();
    if (allProfileIds.size > 0) {
      try {
        const { data: profs } = await sb
          .from('profiles')
          .select('id, full_name, phone_number, avatar_url')
          .in('id', Array.from(allProfileIds));
        if (profs) {
          profs.forEach((p: any) => profilesMap.set(p.id, p));
        }
      } catch (profErr) {
        console.warn('Profiles fetch notice in friendsApi:', profErr);
      }
    }

    const friendMap = new Map<
      string,
      {
        id: string;
        name: string;
        phoneNumber?: string;
        cleanPhone?: string;
        profileId?: string;
        isGuest?: boolean;
        avatarUrl?: string;
        owedToYouPaise: number;
        youOwePaise: number;
        trips: Set<string>;
      }
    >();

    // Process each trip independently
    for (const tId of tripIds) {
      // Merge remote + local cached details for this trip
      let localDetails: any = null;
      try {
        const raw = await AppStorage.getItem(`@splityourtrip_local_details_${tId}`);
        if (raw) localDetails = JSON.parse(raw);
      } catch {}

      const tMembers: TripMember[] = [
        ...remoteMembers.filter((m: any) => m.trip_id === tId),
        ...(localDetails?.members || []).filter(
          (lm: any) => !remoteMembers.some((rm: any) => rm.id === lm.id || (lm.profile_id && rm.profile_id === lm.profile_id))
        ),
      ];

      const tExpenses: any[] = [
        ...remoteExpenses.filter((e: any) => e.trip_id === tId),
        ...(localDetails?.expenses || []).filter(
          (le: any) => !remoteExpenses.some((re: any) => re.id === le.id)
        ),
      ];

      const tripMeta = allTripsMap.get(tId);

      // Handle friend split trips where member row might not have been created yet
      if (tMembers.length <= 1 && tripMeta && (tripMeta.trip_type === 'friend_split' || tripMeta.name?.toLowerCase().startsWith('split with '))) {
        const otherPersonId = tripMeta.created_by === userId ? tripMeta.friend_id : (tripMeta.friend_id === userId ? tripMeta.created_by : null);
        if (otherPersonId) {
          const prof = profilesMap.get(otherPersonId);
          const friendPhone = prof?.phone_number || undefined;
          const rawTripFriendName = tripMeta.name?.replace(/^split with /i, '').trim();
          const friendName = getEffectiveContactName({
            phoneNumber: friendPhone,
            displayName: rawTripFriendName,
            profileName: prof?.full_name,
            fallback: rawTripFriendName || 'Friend',
          });
          const friendKey = otherPersonId;
          const entry = friendMap.get(friendKey) || {
            id: otherPersonId,
            name: friendName,
            phoneNumber: friendPhone,
            cleanPhone: normalizePhone(friendPhone) || undefined,
            profileId: otherPersonId,
            isGuest: false,
            avatarUrl: prof?.avatar_url || undefined,
            owedToYouPaise: 0,
            youOwePaise: 0,
            trips: new Set<string>(),
          };
          if (!entry.name || entry.name === 'Friend') {
            entry.name = friendName;
          }
          entry.trips.add(tId);
          friendMap.set(friendKey, entry);
        }
      }

      if (tMembers.length === 0) continue;

      const myMember =
        tMembers.find(m => m.profile_id === userId || (m as any).user_id === userId) ||
        tMembers.find(m => m.role === 'admin') ||
        tMembers[0];

      if (!myMember) continue;

      // Attach splits to raw expenses
      const expensesWithSplits = tExpenses.map((exp: any) => {
        const expSplits = allSplits.filter((s: any) => s.expense_id === exp.id);
        return {
          ...exp,
          splits: expSplits.length > 0 ? expSplits : exp.splits,
        };
      });

      const normalizedExps = normalizeExpensesForTrip(expensesWithSplits, tMembers);
      const tripBalances = computeBalances(tId, tMembers, normalizedExps);
      const netRecord: Record<string, number> = {};
      tripBalances.forEach(b => {
        netRecord[b.member_id] = b.net_balance;
      });

      // Simplify settlements for this trip
      const settlements = calculateSettlement(netRecord);

      for (const otherMember of tMembers) {
        if (otherMember.id === myMember.id) continue;
        if (otherMember.profile_id && otherMember.profile_id === userId) continue;

        const prof = otherMember.profile_id ? profilesMap.get(otherMember.profile_id) : null;
        const friendPhone = prof?.phone_number || otherMember.phone_number || undefined;
        const normPhone = normalizePhone(otherMember.phone_number);
        const resolvedPhone = normalizePhone(friendPhone) || normPhone;
        const friendKey = otherMember.profile_id || resolvedPhone || otherMember.id;

        const resolvedFriendName = getEffectiveContactName({
          phoneNumber: friendPhone,
          contactName: otherMember.display_name,
          displayName: otherMember.display_name,
          profileName: prof?.full_name,
          fallback: otherMember.display_name || 'Friend',
        });

        const entry = friendMap.get(friendKey) || {
          id: otherMember.profile_id || otherMember.id,
          name: resolvedFriendName,
          phoneNumber: friendPhone,
          cleanPhone: resolvedPhone || undefined,
          profileId: otherMember.profile_id || undefined,
          isGuest: otherMember.is_guest,
          avatarUrl: prof?.avatar_url || (otherMember as any).avatar_url,
          owedToYouPaise: 0,
          youOwePaise: 0,
          trips: new Set<string>(),
        };

        if (prof?.avatar_url && !entry.avatarUrl) {
          entry.avatarUrl = prof.avatar_url;
        }

        // CRITICAL: Prioritize device contact name. If none exists, use profile name!
        const matchedContactName = getContactNameByPhone(friendPhone || entry.phoneNumber || entry.cleanPhone);
        if (matchedContactName) {
          entry.name = matchedContactName;
        } else if (!entry.name || isGenericPlaceholder(entry.name)) {
          entry.name = resolvedFriendName;
        }

        entry.trips.add(tId);

        for (const s of settlements) {
          if (s.from === otherMember.id && s.to === myMember.id) {
            entry.owedToYouPaise += Number(s.amount) || 0;
          } else if (s.from === myMember.id && s.to === otherMember.id) {
            entry.youOwePaise += Number(s.amount) || 0;
          }
        }

        friendMap.set(friendKey, entry);
      }
    }

    let totalOwedToYouPaise = 0;
    let totalYouOwePaise = 0;
    const friendsList: FriendContact[] = [];

    for (const [, f] of friendMap.entries()) {
      const prof = f.profileId ? profilesMap.get(f.profileId) : null;
      const finalResolvedName = getEffectiveContactName({
        phoneNumber: f.phoneNumber || f.cleanPhone,
        contactName: f.name,
        displayName: f.name,
        profileName: prof?.full_name,
        fallback: prof?.full_name || f.name || 'Friend',
      });
      const net = f.owedToYouPaise - f.youOwePaise;
      totalOwedToYouPaise += f.owedToYouPaise;
      totalYouOwePaise += f.youOwePaise;
      friendsList.push({
        id: f.id,
        name: finalResolvedName,
        phoneNumber: f.phoneNumber,
        cleanPhone: f.cleanPhone,
        profileId: f.profileId,
        isGuest: f.isGuest,
        isRegistered: Boolean(f.profileId && !f.isGuest),
        avatarUrl: f.avatarUrl,
        owedToYouPaise: f.owedToYouPaise,
        youOwePaise: f.youOwePaise,
        netBalancePaise: net,
        sharedTripsCount: f.trips.size,
      });
    }

    // Sort: Pending settlements FIRST (net !== 0 or owedToYou > 0 or youOwe > 0),
    // sorted descending by absolute pending balance, then by most shared trips, then alphabetical
    friendsList.sort((a, b) => {
      const aPending = (a.netBalancePaise || 0) !== 0 || (a.owedToYouPaise || 0) > 0 || (a.youOwePaise || 0) > 0;
      const bPending = (b.netBalancePaise || 0) !== 0 || (b.owedToYouPaise || 0) > 0 || (b.youOwePaise || 0) > 0;
      if (aPending && !bPending) return -1;
      if (!aPending && bPending) return 1;
      if (aPending && bPending) {
        return Math.abs(b.netBalancePaise || 0) - Math.abs(a.netBalancePaise || 0);
      }
      const tripDiff = (b.sharedTripsCount || 0) - (a.sharedTripsCount || 0);
      if (tripDiff !== 0) return tripDiff;
      return (a.name || '').localeCompare(b.name || '');
    });

    const result: FriendsApiResult = {
      totalOwedToYouPaise,
      totalYouOwePaise,
      netOverallPaise: totalOwedToYouPaise - totalYouOwePaise,
      friends: friendsList,
    };

    // Cache computed result for subsequent opens
    await AppStorage.setItem(cacheKey, JSON.stringify(result)).catch(() => {});
    return result;
  } catch (err: any) {
    console.warn('fetchFriendsSummaryApi notice:', err?.message);
    return cachedResult || { totalOwedToYouPaise: 0, totalYouOwePaise: 0, netOverallPaise: 0, friends: [] };
  }
}
