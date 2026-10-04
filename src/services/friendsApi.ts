import { supabase, supabaseAdmin, isSupabaseConfigured } from '../lib/supabase';
import { AppStorage } from '../lib/storage';
import { calculateSettlement } from './settle';
import { FriendContact, normalizePhone } from '../features/contacts/useContactsStore';
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

    // 2. Fetch all trips where user is creator, friend, or a member
    const [memberTripsRes, createdTripsRes, friendTripsRes] = await Promise.all([
      sb
        .from('trip_members')
        .select('trip_id, id, profile_id, display_name, phone_number')
        .or(`profile_id.eq.${userId},user_id.eq.${userId}`),
      sb.from('trips').select('id, name, trip_type, friend_id').eq('created_by', userId),
      sb.from('trips').select('id, name, trip_type, friend_id').eq('friend_id', userId),
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

    // 3. Concurrently fetch all members, expenses, and splits for these trips
    const [allMembersRes, allExpensesRes] = await Promise.all([
      sb.from('trip_members').select('*').in('trip_id', tripIds),
      sb.from('expenses').select('*').in('trip_id', tripIds),
    ]);

    const remoteMembers = allMembersRes.data || [];
    const remoteExpenses = allExpensesRes.data || [];
    const expIds = remoteExpenses.map((e: any) => e.id);

    const splitsRes = expIds.length > 0
      ? await sb.from('expense_splits').select('*').in('expense_id', expIds)
      : { data: [] };
    const allSplits = splitsRes.data || [];

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

        const normPhone = normalizePhone(otherMember.phone_number);
        const friendKey = otherMember.profile_id || normPhone || otherMember.id;

        const entry = friendMap.get(friendKey) || {
          id: otherMember.profile_id || otherMember.id,
          name: otherMember.display_name,
          phoneNumber: otherMember.phone_number || undefined,
          cleanPhone: normPhone || undefined,
          profileId: otherMember.profile_id || undefined,
          isGuest: otherMember.is_guest,
          owedToYouPaise: 0,
          youOwePaise: 0,
          trips: new Set<string>(),
        };

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
      const net = f.owedToYouPaise - f.youOwePaise;
      totalOwedToYouPaise += f.owedToYouPaise;
      totalYouOwePaise += f.youOwePaise;
      friendsList.push({
        id: f.id,
        name: f.name,
        phoneNumber: f.phoneNumber,
        cleanPhone: f.cleanPhone,
        profileId: f.profileId,
        isGuest: f.isGuest,
        isRegistered: Boolean(f.profileId && !f.isGuest),
        owedToYouPaise: f.owedToYouPaise,
        youOwePaise: f.youOwePaise,
        netBalancePaise: net,
        sharedTripsCount: f.trips.size,
      });
    }

    // Sort: Pending settlements FIRST (net !== 0 or owedToYou > 0 or youOwe > 0),
    // sorted descending by absolute pending balance
    friendsList.sort((a, b) => {
      const aPending = (a.netBalancePaise || 0) !== 0 || (a.owedToYouPaise || 0) > 0 || (a.youOwePaise || 0) > 0;
      const bPending = (b.netBalancePaise || 0) !== 0 || (b.owedToYouPaise || 0) > 0 || (b.youOwePaise || 0) > 0;
      if (aPending && !bPending) return -1;
      if (!aPending && bPending) return 1;
      if (aPending && bPending) {
        return Math.abs(b.netBalancePaise || 0) - Math.abs(a.netBalancePaise || 0);
      }
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
