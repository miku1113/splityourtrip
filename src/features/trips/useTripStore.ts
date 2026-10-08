import { create } from 'zustand';
import { AppStorage } from '../../lib/storage';
import { supabase, supabaseAdmin, isSupabaseConfigured } from '../../lib/supabase';
import { useAuthStore } from '../auth/useAuthStore';
import {
  Trip,
  TripMember,
  Expense,
  ExpenseSplit,
  TripBalanceRow,
  TripMessage,
  SplitType,
  PaymentMode,
} from '../../types/database';
export type { Trip, TripMember, Expense, ExpenseSplit } from '../../types/database';
import { splitEqual } from '../../services/split';
import { formatCurrencyAmount } from '../../services/currency';
import { getContactNameByPhone, getEffectiveContactName, normalizeNameForMatch } from '../contacts/useContactsStore';
import { uploadTripCoverImage } from '../../services/imageUpload';

// Universal helper to reliably find the active user's TripMember row without assuming admin
export function findMyMember(
  members: TripMember[],
  userId?: string | null,
  userPhone?: string | null
): TripMember | undefined {
  if (!members || members.length === 0) return undefined;

  // 1. Strict match by Supabase auth ID / profile ID
  if (userId) {
    const byProfile = members.find(
      m => (m.profile_id && m.profile_id === userId) || (m.user_id && m.user_id === userId)
    );
    if (byProfile) return byProfile;
  }

  // 2. Strict match by user's phone number
  const cleanPhone = userPhone ? normalizePhone(userPhone) : '';
  if (cleanPhone && cleanPhone.length >= 6) {
    const byPhone = members.find(m => {
      if (!m.phone_number) return false;
      const mNorm = normalizePhone(m.phone_number);
      return mNorm === cleanPhone || (mNorm.length >= 6 && cleanPhone.includes(mNorm.slice(-10)));
    });
    if (byPhone) return byPhone;
  }

  // 3. Fallback ONLY if completely unauthenticated / offline guest mode (no user id and no phone)
  if (!userId && !cleanPhone) {
    return members.find(m => m.role === 'admin') || members[0];
  }

  return undefined;
}

// Helper to generate RFC4122 v4 compliant UUID
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Helper to validate whether a string is a valid UUID
export function isValidUUID(str?: string | null): boolean {
  if (!str) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
}

// Clean phone number to compare reliably (e.g. extracts last 10 digits)
export function normalizePhone(rawPhone?: string | null): string {
  if (!rawPhone) return '';
  const digits = rawPhone.replace(/[^0-9]/g, '');
  if (digits.length > 10) {
    return digits.slice(-10);
  }
  return digits;
}

// User-partitioned local storage key helper to prevent cross-account data leakage
export function getUserTripsStorageKey(userId?: string | null): string {
  let targetId = userId;
  if (!targetId || !isValidUUID(targetId)) {
    try {
      const authUser = useAuthStore.getState().user;
      if (authUser?.id && isValidUUID(authUser.id)) {
        targetId = authUser.id;
      }
    } catch {}
  }
  if (targetId && isValidUUID(targetId)) {
    return `@splityourtrip_local_trips_${targetId}`;
  }
  return '@splityourtrip_local_trips_guest';
}

// SWR throttling & deduplication map
export const tripDetailsFetchTimestamps: Record<string, number> = {};
export const tripDetailsInFlightPromises: Record<string, Promise<void> | undefined> = {};

// Deleted expense IDs tombstone set to prevent zombie resurrection across syncs
export const deletedExpenseIdsSet = new Set<string>();

// Hydrate deleted expenses blacklist from local storage
(async () => {
  try {
    const raw = await AppStorage.getItem('@splityourtrip_deleted_expense_ids');
    if (raw) {
      const ids: string[] = JSON.parse(raw);
      ids.forEach(id => {
        if (id) deletedExpenseIdsSet.add(id);
      });
    }
  } catch {}
})();

export async function markExpenseDeleted(expenseId: string) {
  if (!expenseId) return;
  deletedExpenseIdsSet.add(expenseId);
  try {
    const list = Array.from(deletedExpenseIdsSet).slice(-500);
    await AppStorage.setItem('@splityourtrip_deleted_expense_ids', JSON.stringify(list));
  } catch {}
}

interface TripStoreState {
  trips: Trip[];
  activeTrip: Trip | null;
  members: TripMember[];
  expenses: (Expense & { splits?: ExpenseSplit[]; payerName?: string })[];
  balances: TripBalanceRow[];
  messages: TripMessage[];
  isLoading: boolean;
  isHydrated: boolean;
  error: string | null;

  // Actions
  clearTripStore: () => void;
  initTrips: () => Promise<void>;
  fetchTrips: (userId?: string) => Promise<void>;
  createTrip: (
    name: string,
    userId?: string,
    userName?: string,
    tripType?: 'group' | 'friend_split',
    friendId?: string,
    imageUrl?: string | null,
    description?: string | null,
    initialMembers?: { name: string; phoneNumber?: string }[]
  ) => Promise<Trip | null>;
  updateTrip: (tripId: string, updates: Partial<Trip>) => Promise<Trip | null>;
  deleteTrip: (tripId: string) => Promise<boolean>;
  loadTripDetails: (tripId: string, forceRefresh?: boolean) => Promise<void>;
  prefetchAllTripDetails: (tripIds: string[]) => Promise<void>;
  addGuestMember: (tripId: string, displayName: string, phoneNumber?: string | null) => Promise<TripMember | null>;
  addMember: (data: {
    tripId: string;
    displayName: string;
    phoneNumber?: string | null;
    profileId?: string | null;
    isGuest?: boolean;
  }) => Promise<TripMember | null>;
  removeMember: (tripId: string, memberId: string) => Promise<boolean>;
  findContactByPhone: (
    phoneNumber: string
  ) => Promise<{
    profileId?: string;
    name: string;
    phoneNumber?: string;
    avatarUrl?: string | null;
    isAppUser: boolean;
  } | null>;
  searchRegisteredUsers: (
    query: string
  ) => Promise<Array<{ id: string; full_name: string; phone_number: string | null; avatar_url: string | null }>>;
  generateInviteCode: (tripId: string, userId: string) => Promise<string | null>;
  joinTripByCode: (code: string, userId: string, userName: string) => Promise<boolean>;
  addExpense: (data: {
    tripId: string;
    paidByMemberId: string;
    amountPaise: number;
    description: string;
    category?: string;
    paymentMode: PaymentMode;
    splitType: SplitType;
    participantMemberIds: string[];
    customSplits?: Array<{ memberId: string; shareAmount: number }>;
    upiTxnId?: string;
    location?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    attachmentUrl?: string | null;
    attachmentName?: string | null;
    attachmentType?: 'image' | 'pdf' | 'doc' | null;
    userId: string;
  }) => Promise<boolean>;
  updateExpense: (data: {
    tripId: string;
    expenseId: string;
    amountPaise: number;
    description: string;
    category?: string;
    paidByMemberId?: string;
    paymentMode?: PaymentMode;
    splitType?: SplitType;
    participantMemberIds?: string[];
    customSplits?: Array<{ memberId: string; shareAmount: number }>;
    location?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    attachmentUrl?: string | null;
    attachmentName?: string | null;
    attachmentType?: 'image' | 'pdf' | 'doc' | null;
    userId: string;
    editorName: string;
  }) => Promise<boolean>;
  deleteExpense: (tripId: string, expenseId: string, deleterName?: string) => Promise<boolean>;
  reportExpense: (data: {
    tripId: string;
    expenseId: string;
    reason: string;
    reporterId: string;
    reporterName: string;
  }) => Promise<boolean>;
  sendMessage: (
    tripId: string,
    senderId: string,
    senderName: string,
    text: string,
    mediaData?: { type: 'image' | 'document'; url: string; name?: string; size?: string },
    chatType?: 'group' | 'individual'
  ) => Promise<boolean>;
  markTripMessagesAsSeen: (tripId: string, currentUserId: string) => Promise<void>;
  editTripMessage: (tripId: string, messageId: string, newText: string) => Promise<boolean>;
  deleteTripMessage: (tripId: string, messageId: string) => Promise<boolean>;
  linkGuestWithContact: (data: {
    tripId?: string;
    guestMemberId?: string;
    guestName: string;
    contact: {
      id: string;
      name: string;
      phoneNumber?: string | null;
      profileId?: string | null;
      isRegistered?: boolean;
    };
  }) => Promise<boolean>;
  claimUnlinkedSplits: (userId: string, phoneNumber?: string | null) => Promise<void>;
  findOrCreateFriendSplitTrip: (friend: {
    id: string;
    name: string;
    phoneNumber?: string | null;
    profileId?: string | null;
    isGuest?: boolean;
    defaultTripId?: string;
  }) => Promise<Trip | null>;
  subscribeTripRealtime: (tripId: string) => () => void;
  syncTripMessages: (tripId: string) => Promise<void>;
}

// Helper to prevent any network or native call from hanging indefinitely
function withTimeout<T>(promise: PromiseLike<T>, ms = 5000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Operation timed out after ${ms}ms`));
    }, ms);
    Promise.resolve(promise)
      .then(val => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch(err => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// Helper to deduplicate trips by id
export function deduplicateTrips(trips: Trip[]): Trip[] {
  const seenIds = new Set<string>();
  const result: Trip[] = [];
  for (const t of trips) {
    if (!t || !t.id || seenIds.has(t.id)) continue;
    seenIds.add(t.id);
    result.push(t);
  }
  return result;
}

export function parseMessagePayload(rawContent: string) {
  let msgType:
    | 'text'
    | 'expense'
    | 'dispute'
    | 'system'
    | 'image'
    | 'document'
    | 'payment_settlement'
    | 'payment_claim'
    | 'payment_request' = 'text';
  let displayText = rawContent || '';
  let expData: any = undefined;
  let expId: string | undefined = undefined;
  let mediaUrl: string | undefined = undefined;
  let mediaName: string | undefined = undefined;
  let mediaSize: string | undefined = undefined;
  let chatType: 'group' | 'individual' | undefined = undefined;
  let is_sent: boolean | undefined = undefined;
  let is_seen: boolean | undefined = undefined;
  let is_edited: boolean | undefined = undefined;
  let seen_at: string | undefined = undefined;
  let amountPaise: number | undefined = undefined;
  let rawPayload: any = undefined;

  if (rawContent && rawContent.startsWith('{') && rawContent.includes('"type":')) {
    try {
      const parsed = JSON.parse(rawContent);
      rawPayload = parsed;
      if (parsed.type) msgType = parsed.type;
      if (parsed.text !== undefined) displayText = parsed.text;
      if (parsed.expense_id) expId = parsed.expense_id;
      if (parsed.expense_data) expData = parsed.expense_data;
      if (parsed.media_url) mediaUrl = parsed.media_url;
      else if (parsed.screenshot_url) mediaUrl = parsed.screenshot_url;
      else if (parsed.screenshotUrl) mediaUrl = parsed.screenshotUrl;
      if (parsed.media_name) mediaName = parsed.media_name;
      if (parsed.media_size) mediaSize = parsed.media_size;
      if (parsed.amountPaise !== undefined) amountPaise = Number(parsed.amountPaise);
      else if (parsed.amount_paise !== undefined) amountPaise = Number(parsed.amount_paise);
      if (parsed.is_sent !== undefined) is_sent = !!parsed.is_sent;
      if (parsed.is_seen !== undefined) is_seen = !!parsed.is_seen;
      else if (parsed.seen !== undefined) is_seen = !!parsed.seen;
      if (parsed.is_edited !== undefined) is_edited = !!parsed.is_edited;
      if (parsed.seen_at) seen_at = parsed.seen_at;
      const rawChatType = parsed.chat_type || parsed.chatType;
      if (rawChatType === 'individual' || rawChatType === 'user') {
        chatType = 'individual';
      } else if (rawChatType === 'group' || rawChatType === 'trip') {
        chatType = 'group';
      }
    } catch {}
  }
  return {
    msgType,
    displayText,
    expId,
    expData,
    mediaUrl,
    mediaName,
    mediaSize,
    chatType,
    amountPaise,
    rawPayload,
    is_sent,
    is_seen,
    is_edited,
    seen_at,
  };
}

// Self-healing helper that ensures every expense's paid_by and splits map to valid members of the trip
export function normalizeExpensesForTrip(
  expenses: any[],
  members: TripMember[]
): any[] {
  if (!expenses || expenses.length === 0 || !members || members.length === 0) {
    return expenses || [];
  }

  const adminMember = members.find(m => m.role === 'admin') || members[0];

  return expenses.map(exp => {
    const amount = Number(exp.amount) || 0;

    // 1. Check if merchant_name contains structured JSON { payer_name, payer_id, split_type, splits } or plain text
    let explicitPayerId: string | null = null;
    let explicitPayerName: string | null = exp.payerName || null;
    let metaSplits: any[] = [];
    let metaSplitType: string | null = null;

    if (exp.merchant_name && typeof exp.merchant_name === 'string') {
      const trimmed = exp.merchant_name.trim();
      if (trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.payer_id) explicitPayerId = parsed.payer_id;
          if (parsed.payer_name) explicitPayerName = parsed.payer_name;
          if (Array.isArray(parsed.splits) && parsed.splits.length > 0) metaSplits = parsed.splits;
          if (parsed.split_type) metaSplitType = parsed.split_type;
        } catch {}
      } else if (trimmed) {
        explicitPayerName = trimmed;
      }
    }

    let payerMember: TripMember | undefined;

    // A. Match by explicit payer ID directly (trip_members.id or profile_id)
    if (explicitPayerId) {
      payerMember = members.find(m => m.id === explicitPayerId || (m.profile_id && m.profile_id === explicitPayerId));
    }

    // B. Match by explicit payer display name
    if (!payerMember && explicitPayerName) {
      const pNameLower = explicitPayerName.trim().toLowerCase();
      payerMember = members.find(m => m.display_name.trim().toLowerCase() === pNameLower);
    }

    // C. Check if exp.paid_by matches member.id directly (which is trip_members.id)
    if (!payerMember && exp.paid_by) {
      payerMember = members.find(m => m.id === exp.paid_by);
    }

    // D. Check if exp.paid_by matches member profile_id or user_id
    if (!payerMember && exp.paid_by) {
      payerMember = members.find(
        m => (m.profile_id && m.profile_id === exp.paid_by) || (m.user_id && m.user_id === exp.paid_by)
      );
    }

    // E. Fallback: admin or first member
    if (!payerMember) {
      payerMember = adminMember;
    }

    const rawSplits = Array.isArray(exp.splits) && exp.splits.length > 0 ? exp.splits : metaSplits;
    const matchedSplits: ExpenseSplit[] = [];
    const seenMemberIds = new Set<string>();

    for (const sp of rawSplits) {
      const sm = members.find(
        m =>
          (sp.member_id && (m.id === sp.member_id || m.profile_id === sp.member_id || m.user_id === sp.member_id)) ||
          (sp.profile_id && (m.profile_id === sp.profile_id || m.id === sp.profile_id || m.user_id === sp.profile_id)) ||
          (sp.display_name && m.display_name.trim().toLowerCase() === sp.display_name.trim().toLowerCase()) ||
          (sp.name && m.display_name.trim().toLowerCase() === sp.name.trim().toLowerCase())
      );
      if (sm && !seenMemberIds.has(sm.id)) {
        seenMemberIds.add(sm.id);
        matchedSplits.push({
          ...sp,
          id: sp.id || generateUUID(),
          expense_id: exp.id,
          member_id: sm.id,
          profile_id: sm.profile_id,
          amount: Number(sp.amount !== undefined ? sp.amount : sp.share_amount) || 0,
        });
      }
    }

    const matchedSum = matchedSplits.reduce((s, item) => s + (Number(item.amount) || 0), 0);
    let finalSplits = matchedSplits;

    // Only reconstruct equal splits if NO splits could be matched from anywhere
    if (matchedSplits.length === 0) {
      const equalShares = splitEqual(amount, members.map(m => m.id));
      finalSplits = equalShares.map(es => {
        const mObj = members.find(m => m.id === es.memberId);
        return {
          id: generateUUID(),
          expense_id: exp.id,
          member_id: es.memberId,
          profile_id: mObj?.profile_id,
          amount: es.shareAmount,
        };
      });
    } else if (Math.abs(matchedSum - amount) > Math.max(10, matchedSplits.length * 2)) {
      // Small rounding adjustment distributed among the selected participants without changing participant list
      const diff = amount - matchedSum;
      const count = matchedSplits.length;
      finalSplits = matchedSplits.map((sp, idx) => ({
        ...sp,
        amount: sp.amount + Math.floor(diff / count) + (idx < Math.abs(diff % count) ? Math.sign(diff) : 0),
      }));
    }

    return {
      ...exp,
      paid_by: payerMember.id,
      payerName: payerMember.display_name || exp.payerName || 'Member',
      split_type: exp.split_type || metaSplitType || 'equal',
      splits: finalSplits,
    };
  });
}

// Compute member balances directly from loaded expenses and splits
export function computeBalances(
  tripId: string,
  members: TripMember[],
  expenses: Expense[],
  splits?: ExpenseSplit[]
): TripBalanceRow[] {
  const normalizedExps = normalizeExpensesForTrip(expenses, members);
  const effectiveSplits: ExpenseSplit[] =
    normalizedExps.length > 0
      ? normalizedExps.flatMap((e: any) => e.splits || [])
      : splits || [];

  const memberBalances: Record<
    string,
    { paid: number; share: number; member: TripMember }
  > = {};

  for (const m of members) {
    memberBalances[m.id] = { paid: 0, share: 0, member: m };
  }

  for (const exp of normalizedExps) {
    const payerMember = members.find(
      m => m.id === exp.paid_by || m.profile_id === exp.paid_by || m.user_id === exp.paid_by
    );
    if (payerMember && memberBalances[payerMember.id]) {
      memberBalances[payerMember.id].paid += Number(exp.amount) || 0;
    }
  }

  for (const sp of effectiveSplits) {
    const splitMember = members.find(
      m =>
        m.id === sp.member_id ||
        (sp.profile_id && (m.profile_id === sp.profile_id || m.id === sp.profile_id || m.user_id === sp.profile_id))
    );
    if (splitMember && memberBalances[splitMember.id]) {
      memberBalances[splitMember.id].share += Number(sp.amount) || 0;
    }
  }

  return members.map(m => {
    const data = memberBalances[m.id] || { paid: 0, share: 0, member: m };
    const net = data.paid - data.share;
    return {
      trip_id: tripId,
      member_id: m.id,
      display_name: m.display_name,
      user_id: m.user_id || m.profile_id || null,
      role: m.role || 'member',
      status: 'accepted',
      is_guest: Boolean(m.is_guest),
      total_paid: data.paid,
      total_share: data.share,
      total_repaid: 0,
      total_received: 0,
      net_balance: net,
    };
  });
}

export const useTripStore = create<TripStoreState>((set, get) => ({
  trips: [],
  activeTrip: null,
  members: [],
  expenses: [],
  balances: [],
  messages: [],
  isLoading: false,
  isHydrated: false,
  error: null,

  clearTripStore: () => {
    set({
      trips: [],
      activeTrip: null,
      members: [],
      expenses: [],
      balances: [],
      messages: [],
      isLoading: false,
      error: null,
    });
  },

  initTrips: async () => {
    try {
      const authUser = useAuthStore.getState().user;
      const profileId = useAuthStore.getState().profile?.id;
      const targetUserId =
        authUser?.id && isValidUUID(authUser.id)
          ? authUser.id
          : profileId && isValidUUID(profileId)
          ? profileId
          : null;
      const storageKey = getUserTripsStorageKey(targetUserId);

      const localTripsRaw = await AppStorage.getItem(storageKey);
      if (localTripsRaw) {
        const localTrips: Trip[] = JSON.parse(localTripsRaw);
        if (Array.isArray(localTrips) && localTrips.length > 0) {
          const filtered = targetUserId
            ? localTrips.filter(t => !t.created_by || t.created_by === targetUserId || t.created_by === 'local_user')
            : localTrips;
          set({ trips: deduplicateTrips(filtered), isHydrated: true });
        } else {
          set({ trips: [], isHydrated: true });
        }
      } else {
        set({ trips: [], isHydrated: true });
      }
    } catch (e) {
      console.log('initTrips local read notice:', e);
      set({ isHydrated: true });
    }
    // Also trigger fetch to sync with cloud if auth session exists
    get().fetchTrips();
  },

  fetchTrips: async (userId?: string) => {
    // 1. Resolve active authenticated user ID first
    let targetUserId = userId;
    if (!targetUserId || !isValidUUID(targetUserId)) {
      const authUser = useAuthStore.getState().user;
      if (authUser?.id && isValidUUID(authUser.id)) {
        targetUserId = authUser.id;
      } else {
        const profileId = useAuthStore.getState().profile?.id;
        if (profileId && isValidUUID(profileId)) {
          targetUserId = profileId;
        } else if (isSupabaseConfigured) {
          try {
            const { data: { session } } = await withTimeout(supabase.auth.getSession(), 4000);
            if (session?.user?.id && isValidUUID(session.user.id)) {
              targetUserId = session.user.id;
            }
          } catch {}
        }
      }
    }

    const storageKey = getUserTripsStorageKey(targetUserId);

    // If current store contains trips from a DIFFERENT user, clear them immediately
    const currentTrips = get().trips;
    if (targetUserId && currentTrips.some(t => t.created_by && t.created_by !== targetUserId && t.created_by !== 'local_user')) {
      set({ trips: [], isLoading: true });
    }

    // 2. Load user-partitioned local trips
    let localTrips: Trip[] = [];
    try {
      const localTripsRaw = await AppStorage.getItem(storageKey);
      if (localTripsRaw) {
        const parsed = JSON.parse(localTripsRaw);
        if (Array.isArray(parsed)) {
          localTrips = deduplicateTrips(parsed).filter(t => {
            if (!targetUserId) return true;
            return !t.created_by || t.created_by === targetUserId || t.created_by === 'local_user';
          });
        }
      }
    } catch (e) {
      console.log('fetchTrips local storage read notice:', e);
    }

    // 3. One-time safe migration & cleanup for legacy unpartitioned storage key
    try {
      const legacyRaw = await AppStorage.getItem('@splityourtrip_local_trips');
      if (legacyRaw) {
        const parsedLegacy = JSON.parse(legacyRaw);
        if (Array.isArray(parsedLegacy) && parsedLegacy.length > 0 && targetUserId) {
          const matchingLegacy = parsedLegacy.filter(t => t.created_by === targetUserId);
          if (matchingLegacy.length > 0 && localTrips.length === 0) {
            localTrips = deduplicateTrips(matchingLegacy);
            await AppStorage.setItem(storageKey, JSON.stringify(localTrips));
          }
        }
        // Always remove unpartitioned key to eliminate cross-account leakage
        await AppStorage.removeItem('@splityourtrip_local_trips');
      }
    } catch {}

    // Immediately display user-isolated local trips and clear loading if we already have local data for this user
    if (localTrips.length > 0) {
      set({ trips: localTrips, isLoading: false, isHydrated: true, error: null });
    } else {
      set({ trips: [], isLoading: true, error: null });
    }

    // If unauthenticated or no valid user UUID, finish with local trips
    if (!isSupabaseConfigured || !targetUserId || !isValidUUID(targetUserId)) {
      set({ trips: localTrips, isLoading: false, isHydrated: true });
      return;
    }

    // ── Ensure active session is refreshed if available (non-blocking) ──
    try {
      await withTimeout(supabase.auth.getSession(), 2000);
    } catch {}

    // ── Auto-claim any splits or trips created before this user joined ──
    const authState = useAuthStore.getState();
    const userPhone = authState.profile?.phone_number || (authState.user as any)?.phone || (authState.user as any)?.user_metadata?.phone_number;
    const cleanDigits = userPhone ? (userPhone as string).replace(/[^0-9]/g, '') : '';
    const last10Phone = cleanDigits.length >= 6 ? cleanDigits.slice(-10) : '';

    try {
      if (userPhone && targetUserId) {
        await get().claimUnlinkedSplits(targetUserId, userPhone);
      }
    } catch {}

    try {
      const memberQueryFilter = last10Phone
        ? `profile_id.eq.${targetUserId},user_id.eq.${targetUserId},phone_number.ilike.%${last10Phone}%`
        : `profile_id.eq.${targetUserId},user_id.eq.${targetUserId}`;

      // Execute created trips, member rows, and friend trips concurrently in parallel!
      const [createdRes, memberRes, friendRes] = await Promise.all([
        withTimeout(
          supabaseAdmin
            .from('trips')
            .select('*')
            .eq('created_by', targetUserId)
            .order('created_at', { ascending: false }),
          3500
        ).catch(() => ({ data: [] as any[], error: null })),
        withTimeout(
          supabaseAdmin
            .from('trip_members')
            .select('trip_id')
            .or(memberQueryFilter),
          3500
        ).catch(() => ({ data: [] as any[], error: null })),
        withTimeout(
          supabaseAdmin
            .from('trips')
            .select('*')
            .eq('friend_id', targetUserId)
            .order('created_at', { ascending: false }),
          3500
        ).catch(() => ({ data: [] as any[], error: null })),
      ]);

      const createdTrips: Trip[] = (createdRes.data || []) as Trip[];
      const memberRows: any[] = memberRes.data || [];
      const friendTrips: Trip[] = (friendRes.data || []) as Trip[];

      const memberTripIds = memberRows
        .map((r: any) => r.trip_id)
        .filter((id: string) => !createdTrips.some((ct: any) => ct.id === id));

      let memberTrips: Trip[] = [];
      if (memberTripIds.length > 0) {
        const { data: mtData } = await withTimeout(
          supabaseAdmin
            .from('trips')
            .select('*')
            .in('id', memberTripIds)
            .order('created_at', { ascending: false }),
          3500
        ).catch(() => ({ data: [] }));
        memberTrips = (mtData || []) as Trip[];
      }

      // Merge remote and local trips:
      // Remote (Supabase) wins for server-side fields, but local wins for
      // fields that Supabase doesn't store (trip_type, friend_id, currency, etc.)
      const remoteTrips = deduplicateTrips([
        ...(createdTrips || []),
        ...(memberTrips || []),
        ...((friendTrips as Trip[]) || []),
      ]);
      const mergedTripsMap = new Map<string, Trip>();

      // Build a quick lookup for local trips by id
      const localTripById = new Map<string, Trip>();
      localTrips.forEach(t => localTripById.set(t.id, t));

      // For every remote trip, merge with local data to preserve local-only fields
      remoteTrips.forEach(remoteTrip => {
        const localVersion = localTripById.get(remoteTrip.id);
        if (localVersion) {
          // Merge: remote base + local-only fields that remote doesn't have
          mergedTripsMap.set(remoteTrip.id, {
            ...remoteTrip,
            trip_type: remoteTrip.trip_type || localVersion.trip_type,
            friend_id: remoteTrip.friend_id || localVersion.friend_id,
            currency: remoteTrip.currency || localVersion.currency,
          });
        } else {
          mergedTripsMap.set(remoteTrip.id, remoteTrip);
        }
      });

      // Add local-only trips (strictly verifying ownership) and auto-sync them to Supabase
      const localOnlyTripsToSync: Trip[] = [];
      localTrips.forEach(t => {
        const belongsToUser =
          t.created_by === targetUserId ||
          (!t.created_by && !remoteTrips.some(rt => rt.id === t.id));

        // Strictly reject any trip belonging to a different user
        if (t.created_by && t.created_by !== targetUserId && t.created_by !== 'local_user') {
          return;
        }

        if (belongsToUser && !mergedTripsMap.has(t.id)) {
          const syncedTrip: Trip = {
            ...t,
            created_by: targetUserId,
          };
          mergedTripsMap.set(t.id, syncedTrip);
          if (!remoteTrips.some(rt => rt.id === t.id)) {
            localOnlyTripsToSync.push(syncedTrip);
          }
        }
      });

      // Background auto-sync of local-only trips to Supabase so reinstall or new device login has all data
      if (localOnlyTripsToSync.length > 0 && isSupabaseConfigured && targetUserId && isValidUUID(targetUserId)) {
        (async () => {
          for (const tripToSync of localOnlyTripsToSync) {
            try {
              const inviteCode = tripToSync.invite_code || Math.random().toString(36).substring(2, 8).toUpperCase();
              await supabase.from('trips').upsert({
                id: tripToSync.id,
                name: tripToSync.name,
                description: tripToSync.description || '',
                trip_type: tripToSync.trip_type || 'group',
                friend_id: tripToSync.friend_id || null,
                image_url: tripToSync.image_url || null,
                currency: tripToSync.currency || 'INR',
                status: tripToSync.status || 'active',
                invite_code: inviteCode,
                created_by: targetUserId,
              }, { onConflict: 'id' });

              const authState = useAuthStore.getState();
              const userName = authState.profile?.full_name || authState.profile?.name || (authState.user as any)?.email?.split('@')[0] || 'You';
              const userPhone = authState.profile?.phone_number || (authState.user as any)?.phone || (authState.user as any)?.user_metadata?.phone_number || null;
              await supabaseAdmin.from('trip_members').upsert({
                trip_id: tripToSync.id,
                profile_id: targetUserId,
                user_id: targetUserId,
                display_name: userName,
                phone_number: userPhone,
                role: 'admin',
                status: 'accepted',
                is_guest: false,
              }, { onConflict: 'trip_id,profile_id' });

              // Also sync local expenses if available
              const localDetailsRaw = await AppStorage.getItem(`@splityourtrip_local_details_${tripToSync.id}`);
              if (localDetailsRaw) {
                const details = JSON.parse(localDetailsRaw);
                if (Array.isArray(details.expenses) && details.expenses.length > 0) {
                  for (const exp of details.expenses) {
                    if (isValidUUID(exp.id)) {
                      const merchantPayload = JSON.stringify({
                        payer_name: exp.payerName || 'Member',
                        payer_id: exp.paid_by || null,
                      });
                      await supabase.from('expenses').upsert({
                        id: exp.id,
                        trip_id: tripToSync.id,
                        amount: exp.amount,
                        paid_by: targetUserId,
                        merchant_name: merchantPayload,
                        expense_type: 'manual',
                        description: exp.description || 'Expense',
                        category: exp.category || 'General',
                        payment_mode: exp.payment_mode || 'upi',
                        split_type: exp.split_type || 'equal',
                        currency: exp.currency || 'INR',
                        created_by: targetUserId,
                      }, { onConflict: 'id' });
                    }
                  }
                }
              }
            } catch (syncErr: any) {
              console.log('Background trip auto-sync notice:', syncErr?.message);
            }
          }
        })();
      }

      const finalTrips = Array.from(mergedTripsMap.values())
        .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

      // Save user-isolated merged list back to AppStorage
      try {
        await AppStorage.setItem(storageKey, JSON.stringify(finalTrips));
      } catch {}

      set({ trips: finalTrips, isLoading: false, isHydrated: true });

      // Automatically prefetch & cache expenses, members and splits across all trips in background
      // and compute friend balances so Friends list is instantly populated without needing to open each trip!
      (async () => {
        try {
          await get().prefetchAllTripDetails(finalTrips.map(t => t.id));
          const { useContactsStore } = require('../contacts/useContactsStore');
          useContactsStore.getState().computeFriendBalances(finalTrips, targetUserId).catch(() => {});
        } catch {}
      })();
    } catch (err: any) {
      console.log('fetchTrips network notice, preserving local trips:', err?.message);
      set({ trips: localTrips, isLoading: false, isHydrated: true });
    }
  },

  createTrip: async (
    name: string,
    userId?: string,
    userName?: string,
    tripType: 'group' | 'friend_split' = 'group',
    friendId?: string,
    imageUrl?: string | null,
    description?: string | null,
    initialMembers?: { name: string; phoneNumber?: string }[]
  ) => {
    let authUser = useAuthStore.getState().user;
    if (!authUser?.id) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          authUser = session.user;
        }
      } catch {}
    }

    const profileId = useAuthStore.getState().profile?.id;
    const authenticatedUserId =
      authUser?.id && isValidUUID(authUser.id)
        ? authUser.id
        : isValidUUID(userId)
        ? userId!
        : profileId && isValidUUID(profileId)
        ? profileId
        : null;
    const effectiveUserId = authenticatedUserId || generateUUID();
    const effectiveUserName = userName || (authUser as any)?.user_metadata?.full_name || (authUser as any)?.user_metadata?.name || 'Traveler';

    const newTripId = generateUUID();
    const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    let finalImageUrl = imageUrl || null;
    if (imageUrl && (imageUrl.startsWith('file:') || imageUrl.startsWith('content:') || imageUrl.startsWith('ph:'))) {
      try {
        finalImageUrl = await uploadTripCoverImage(newTripId, imageUrl);
      } catch (err) {
        console.warn('Trip cover image upload notice:', err);
      }
    }

    const tripData: Trip = {
      id: newTripId,
      name: name.trim(),
      description: description || '',
      trip_type: tripType,
      friend_id: friendId,
      image_url: finalImageUrl,
      invite_code: inviteCode,
      created_by: effectiveUserId,
      created_at: new Date().toISOString(),
    };

    const authState = useAuthStore.getState();
    const effectiveUserPhone =
      authState.profile?.phone_number ||
      (authUser as any)?.phone ||
      (authUser as any)?.user_metadata?.phone_number ||
      null;

    const adminMember: TripMember = {
      id: generateUUID(),
      trip_id: tripData.id,
      profile_id: effectiveUserId,
      user_id: effectiveUserId,
      display_name: effectiveUserName || 'You',
      phone_number: effectiveUserPhone,
      role: 'admin',
      status: 'accepted',
      is_guest: false,
      created_at: new Date().toISOString(),
    };

    const extraMembers: TripMember[] = (initialMembers || [])
      .filter(m => m && m.name && m.name.trim().length > 0)
      .map(m => {
        const contactName = getContactNameByPhone(m.phoneNumber);
        return {
          id: generateUUID(),
          trip_id: tripData.id,
          display_name: contactName || m.name.trim(),
          phone_number: m.phoneNumber ? m.phoneNumber.trim() : null,
          role: 'member',
          status: 'accepted',
          is_guest: true,
          created_at: new Date().toISOString(),
        };
      });

    const allInitialMembers: TripMember[] = [adminMember, ...extraMembers];

    // Merge into local list immediately
    const currentTrips = get().trips.filter(t => t.id !== tripData.id);
    const newTrips = [tripData, ...currentTrips];

    const initialBalances: TripBalanceRow[] = allInitialMembers.map(m => ({
      trip_id: tripData.id,
      member_id: m.id,
      display_name: m.display_name,
      user_id: m.user_id || null,
      role: m.role || 'member',
      status: 'accepted',
      is_guest: m.is_guest || false,
      total_paid: 0,
      total_share: 0,
      total_repaid: 0,
      total_received: 0,
      net_balance: 0,
    }));

    set({
      trips: newTrips,
      activeTrip: tripData,
      members: allInitialMembers,
      expenses: [],
      balances: initialBalances,
      isLoading: false,
      isHydrated: true,
    });

    // Persist immediately to AppStorage
    try {
      const userTripsKey = getUserTripsStorageKey(authenticatedUserId);
      await AppStorage.setItem(userTripsKey, JSON.stringify(newTrips));
      await AppStorage.setItem(`@splityourtrip_local_details_${tripData.id}`, JSON.stringify({
        members: allInitialMembers,
        expenses: [],
        messages: [],
      }));
    } catch (e: any) {
      console.log('AppStorage write notice:', e?.message);
    }

    // Sync to Supabase directly and await with timeout so it reliably persists in cloud
    if (isSupabaseConfigured) {
      try {
        if (authenticatedUserId) {
          try {
            await supabaseAdmin.from('profiles').upsert({
              id: authenticatedUserId,
              full_name: effectiveUserName,
              name: effectiveUserName,
            }, { onConflict: 'id' });
          } catch {}
        }

        const tripPayload = {
          id: newTripId,
          name: name.trim(),
          description: description || '',
          trip_type: tripType,
          friend_id: friendId || null,
          image_url: imageUrl || null,
          currency: 'INR',
          status: 'active',
          invite_code: inviteCode,
          created_by: authenticatedUserId || null,
        };

        let { error: tripError } = await withTimeout(
          supabaseAdmin
            .from('trips')
            .upsert(tripPayload, { onConflict: 'id' }),
          5000
        );

        if (tripError) {
          console.warn('Admin trip upsert notice, trying user client:', tripError.message);
          const res = await withTimeout(
            supabase.from('trips').upsert(tripPayload, { onConflict: 'id' }),
            5000
          );
          tripError = res.error;
        }

        // Insert admin member + all added members into trip_members
        for (const m of allInitialMembers) {
          const memberPayload = {
            id: m.id,
            trip_id: newTripId,
            profile_id: m.profile_id || null,
            user_id: m.user_id || null,
            display_name: m.display_name,
            phone_number: m.phone_number || null,
            role: m.role || 'member',
            status: 'accepted',
            is_guest: m.is_guest !== undefined ? m.is_guest : !m.profile_id,
          };
          const { error: mErr } = await supabaseAdmin
            .from('trip_members')
            .upsert(memberPayload, { onConflict: 'id' });
          if (mErr) {
            await supabase
              .from('trip_members')
              .upsert(memberPayload, { onConflict: 'id' });
          }
        }
      } catch (err: any) {
        console.warn('Supabase trip sync notice:', err?.message);
      }
    }

    return tripData;
  },

  updateTrip: async (tripId: string, updates: Partial<Trip>) => {
    const authUser = useAuthStore.getState().user;
    const currentTrips = get().trips;
    let target = currentTrips.find(t => t.id === tripId);
    if (!target && get().activeTrip?.id === tripId) {
      target = get().activeTrip!;
    }
    if (!target) {
      target = {
        id: tripId,
        name: updates.name || 'Trip',
        description: updates.description || '',
        currency: updates.currency || 'INR',
        status: updates.status || 'active',
        image_url: updates.image_url || null,
        created_by: authUser?.id || '',
        created_at: new Date().toISOString(),
      };
    }

    let finalImageUrl = updates.image_url !== undefined ? updates.image_url : target.image_url;
    if (finalImageUrl && (finalImageUrl.startsWith('file:') || finalImageUrl.startsWith('content:') || finalImageUrl.startsWith('ph:'))) {
      try {
        finalImageUrl = await uploadTripCoverImage(tripId, finalImageUrl);
      } catch (err) {
        console.warn('Trip cover image upload notice on update:', err);
      }
    }

    const updatedTrip: Trip = {
      ...target,
      ...updates,
      image_url: finalImageUrl,
      id: tripId,
      updated_at: new Date().toISOString(),
    };

    const newTrips = currentTrips.some(t => t.id === tripId)
      ? currentTrips.map(t => (t.id === tripId ? updatedTrip : t))
      : [updatedTrip, ...currentTrips];

    const newActive = get().activeTrip?.id === tripId ? updatedTrip : (get().activeTrip || updatedTrip);

    // 1. Immediately update Zustand state
    set({ trips: newTrips, activeTrip: newActive });

    // 2. Immediately persist to AppStorage
    try {
      const userTripsKey = getUserTripsStorageKey(authUser?.id);
      await AppStorage.setItem(userTripsKey, JSON.stringify(newTrips));

      const localDetailsKey = `@splityourtrip_local_details_${tripId}`;
      const existingDetails = await AppStorage.getItem(localDetailsKey);
      if (existingDetails) {
        try {
          const parsed = JSON.parse(existingDetails);
          await AppStorage.setItem(localDetailsKey, JSON.stringify({ ...parsed, trip: updatedTrip }));
        } catch {}
      } else {
        await AppStorage.setItem(
          localDetailsKey,
          JSON.stringify({ trip: updatedTrip, members: [], expenses: [], messages: [] })
        );
      }
    } catch (e) {
      console.warn('Failed to persist updated trip:', e);
    }

    // 3. Supabase sync with supabaseAdmin and supabase fallback
    if (isSupabaseConfigured && isValidUUID(tripId)) {
      try {
        const updateData: any = {
          name: updatedTrip.name,
          description: updatedTrip.description || null,
          currency: updatedTrip.currency || 'INR',
          status: updatedTrip.status || 'active',
          trip_type: updatedTrip.trip_type || 'group',
          friend_id: updatedTrip.friend_id || null,
          image_url: updatedTrip.image_url || null,
          updated_at: new Date().toISOString(),
        };

        const adminRes = await withTimeout(
          supabaseAdmin.from('trips').update(updateData).eq('id', tripId),
          3500
        ).catch(() => null);

        if (!adminRes || adminRes.error) {
          await withTimeout(
            supabase.from('trips').update(updateData).eq('id', tripId),
            3000
          ).catch(() => null);
        }
      } catch (e) {
        console.warn('Supabase updateTrip notice:', e);
      }
    }

    return updatedTrip;
  },

  deleteTrip: async (tripId: string) => {
    const authUser = useAuthStore.getState().user;
    const currentTrips = get().trips;
    const newTrips = currentTrips.filter(t => t.id !== tripId);

    set({
      trips: newTrips,
      activeTrip: get().activeTrip?.id === tripId ? null : get().activeTrip,
    });

    try {
      const userTripsKey = getUserTripsStorageKey(authUser?.id);
      await AppStorage.setItem(userTripsKey, JSON.stringify(newTrips));
      await AppStorage.removeItem(`@splityourtrip_local_details_${tripId}`);
    } catch (e) {
      console.warn('Failed to delete trip from storage:', e);
    }

    if (isSupabaseConfigured && isValidUUID(tripId)) {
      try {
        // Cascade delete child entities first
        await withTimeout(supabaseAdmin.from('trip_messages').delete().eq('trip_id', tripId), 3000).catch(() => null);
        await withTimeout(supabaseAdmin.from('expense_splits').delete().eq('trip_id', tripId), 3000).catch(() => null);
        await withTimeout(supabaseAdmin.from('expenses').delete().eq('trip_id', tripId), 3000).catch(() => null);
        await withTimeout(supabaseAdmin.from('trip_members').delete().eq('trip_id', tripId), 3000).catch(() => null);
        await withTimeout(supabaseAdmin.from('invites').delete().eq('trip_id', tripId), 3000).catch(() => null);

        // Delete trip record
        const adminRes = await withTimeout(
          supabaseAdmin.from('trips').delete().eq('id', tripId),
          3500
        ).catch(() => null);

        if (!adminRes || adminRes.error) {
          await withTimeout(
            supabase.from('trips').delete().eq('id', tripId),
            3000
          ).catch(() => null);
        }
      } catch (e) {
        console.warn('Supabase deleteTrip notice:', e);
      }
    }

    return true;
  },

  loadTripDetails: async (tripId: string, forceRefresh = false) => {
    if (!tripId) return;

    const localTrip = get().trips.find(t => t.id === tripId);
    const isSwitchingTrip = get().activeTrip?.id !== tripId;

    // 1. Try loading cached/local details from AppStorage first (instant local render)
    let localDetails: { members: TripMember[]; expenses: any[]; messages: TripMessage[] } | null = null;
    try {
      const raw = await AppStorage.getItem(`@splityourtrip_local_details_${tripId}`);
      if (raw) {
        localDetails = JSON.parse(raw);
      }
    } catch {}

    if (localDetails) {
      const localMembers = (localDetails.members || []).map((m: any) => ({
        ...m,
        trip_id: m.trip_id || tripId,
      }));
      // Filter out any tombstoned expenses
      const filteredLocalExpenses = (localDetails.expenses || [])
        .filter((e: any) => !deletedExpenseIdsSet.has(e.id))
        .map((e: any) => ({ ...e, trip_id: e.trip_id || tripId }));
      const localExpenses = normalizeExpensesForTrip(filteredLocalExpenses, localMembers);
      const localSplits = localExpenses.flatMap((e: any) => e.splits || []);
      const localBalances = computeBalances(
        tripId,
        localMembers,
        localExpenses,
        localSplits
      );

      const validLocalExpIds = new Set(localExpenses.map((e: any) => e.id));
      // STRICT ISOLATION: strictly only load messages belonging to this specific tripId!
      const filteredLocalMessages = (localDetails.messages || []).filter((m: any) => {
        if (m.trip_id && m.trip_id !== tripId) return false;
        const expId = m.expense_id || m.expense_data?.id;
        if (expId && (deletedExpenseIdsSet.has(expId) || !validLocalExpIds.has(expId))) {
          return false;
        }
        return true;
      });

      set({
        activeTrip: localTrip || get().activeTrip,
        members: localMembers,
        expenses: localExpenses,
        messages: filteredLocalMessages,
        balances: localBalances,
        isLoading: false,
        error: null,
      });
    } else {
      // Switched trips with no local cache yet: IMMEDIATELY clear previous trip state so cross-trip messages NEVER leak!
      if (isSwitchingTrip) {
        set({
          activeTrip: localTrip || null,
          members: [],
          expenses: [],
          messages: [],
          balances: [],
          isLoading: true,
          error: null,
        });
      } else {
        set({ isLoading: true, error: null });
      }
    }

    // 2. Throttle check to avoid spamming server
    const now = Date.now();
    const lastFetched = tripDetailsFetchTimestamps[tripId] || 0;
    const isThrottled = !forceRefresh && (now - lastFetched < 15000); // 15-second throttle window

    if (isThrottled) {
      return;
    }

    // Deduplicate in-flight requests for the same tripId
    if (tripDetailsInFlightPromises[tripId]) {
      return tripDetailsInFlightPromises[tripId];
    }

    const fetchPromise = (async () => {
      try {
        if (!isSupabaseConfigured || !isValidUUID(tripId)) {
          set({ isLoading: false });
          return;
        }

        tripDetailsFetchTimestamps[tripId] = Date.now();

        // Wave 1: Fetch trip record, members, and expenses concurrently in parallel!
        const [tripRes, membersRes, expensesRes] = await Promise.all([
        withTimeout(
          supabaseAdmin
            .from('trips')
            .select('*')
            .eq('id', tripId)
            .maybeSingle(),
          3500
        ).catch(() => ({ data: null, error: null })),
        withTimeout(
          supabaseAdmin
            .from('trip_members')
            .select('*')
            .eq('trip_id', tripId),
          3500
        ).catch(() => ({ data: [] as any[], error: null })),
        withTimeout(
          supabaseAdmin
            .from('expenses')
            .select('*')
            .eq('trip_id', tripId)
            .order('created_at', { ascending: false }),
          3500
        ).catch(() => ({ data: [] as any[], error: null })),
      ]);

      const tripData = tripRes.data;
      const membersRaw: any[] = membersRes.data || [];
      const expensesRaw: any[] = expensesRes.data || [];

      let mergedActiveTrip: Trip | null = localTrip || null;
      if (tripData) {
        // Merge Supabase data with local trip to preserve local-only fields
        // (trip_type, friend_id, currency, etc. that Supabase schema may not have)
        mergedActiveTrip = {
          ...(tripData as Trip),
          trip_type: (tripData as any).trip_type || localTrip?.trip_type,
          friend_id: (tripData as any).friend_id || localTrip?.friend_id,
          currency: (tripData as any).currency || localTrip?.currency,
        };
        set({ activeTrip: mergedActiveTrip });

        // Also update the trip in the trips list and re-save to local storage
        const updatedTrips = get().trips.map(t =>
          t.id === tripId ? { ...t, ...mergedActiveTrip! } : t
        );
        set({ trips: updatedTrips });
        try {
          const userTripsKey = getUserTripsStorageKey();
          await AppStorage.setItem(userTripsKey, JSON.stringify(updatedTrips));
        } catch {}
      } else if (!localTrip && !localDetails) {
        set({ isLoading: false });
        return;
      }

      // Wave 2: Fetch profiles for members and expense splits concurrently in parallel!
      const profileIds = (membersRaw || []).map((m: any) => m.profile_id).filter(Boolean);
      const expenseIds = (expensesRaw || []).map((e: any) => e.id);

      const [profilesRes, splitsRes] = await Promise.all([
        profileIds.length > 0
          ? withTimeout(
              supabaseAdmin
                .from('profiles')
                .select('id, full_name, phone_number')
                .in('id', profileIds),
              3000
            ).catch(() => ({ data: [] as any[] }))
          : Promise.resolve({ data: [] as any[] }),
        expenseIds.length > 0
          ? withTimeout(
              supabaseAdmin
                .from('expense_splits')
                .select('*')
                .in('expense_id', expenseIds),
              3000
            ).catch(() => ({ data: [] as any[] }))
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const profilesData = profilesRes.data || [];
      const allSplits = (splitsRes.data || []) as ExpenseSplit[];

      let profileMap = new Map<string, { full_name: string; phone_number?: string | null }>();
      profilesData.forEach((p: any) => {
        profileMap.set(p.id, {
          full_name: p.full_name || 'Traveler',
          phone_number: p.phone_number || null,
        });
      });

      const existingMembers = localDetails?.members || [];
      const enrichedMembers: TripMember[] = (membersRaw || []).map((m: any) => {
        const pInfo = profileMap.get(m.profile_id);
        const localMatch = existingMembers.find(
          em => em.id === m.id || (m.profile_id && em.profile_id === m.profile_id)
        );
        const resolvedPhone = pInfo?.phone_number || localMatch?.phone_number || m.phone_number || null;
        const resolvedDisplayName = getEffectiveContactName({
          phoneNumber: resolvedPhone,
          contactName: localMatch?.display_name,
          displayName: m.display_name,
          profileName: pInfo?.full_name,
          fallback: localMatch?.display_name || m.display_name || 'Member',
        });
        return {
          id: m.id,
          trip_id: m.trip_id,
          profile_id: m.profile_id,
          user_id: m.profile_id,
          display_name: resolvedDisplayName,
          phone_number: resolvedPhone,
          role: m.role || 'member',
          status: 'accepted',
          joined_at: m.joined_at,
          created_at: m.joined_at,
          is_guest: localMatch?.is_guest === false ? false : Boolean(!m.profile_id && !resolvedPhone),
        };
      });

      // Merge local members if any
      const memberMap = new Map<string, TripMember>();
      enrichedMembers.forEach(m => memberMap.set(m.id, m));
      existingMembers.forEach(m => {
        const alreadyByProfile = m.profile_id && enrichedMembers.some(em => em.profile_id === m.profile_id);
        if (!memberMap.has(m.id) && !alreadyByProfile) {
          memberMap.set(m.id, m);
        }
      });
      const finalMembers = Array.from(memberMap.values());

      // 8. Enrich expenses
      const memberNameById = new Map<string, string>();
      finalMembers.forEach(m => {
        memberNameById.set(m.id, m.display_name);
        if (m.profile_id) memberNameById.set(m.profile_id, m.display_name);
      });

      const isFriendSplit =
        tripData?.trip_type === 'friend_split' ||
        (tripData as any)?.is_friend_split ||
        tripData?.name?.toLowerCase().startsWith('split with ') ||
        Boolean(tripData?.friend_id) ||
        Boolean(localTrip?.friend_id);
      const defaultChatType: 'group' | 'individual' = isFriendSplit ? 'individual' : 'group';

      const enrichedExpenses = (expensesRaw || []).map(exp => {
        const expSplits = allSplits.filter(s => s.expense_id === exp.id);
        const localExp = (localDetails?.expenses || []).find((le: any) => le.id === exp.id);

        let parsedPayerId: string | null = null;
        let parsedPayerName: string | null = null;
        let metaSplits: any[] = [];
        let metaSplitType: string | null = null;

        if (exp.merchant_name && typeof exp.merchant_name === 'string') {
          const trimmed = exp.merchant_name.trim();
          if (trimmed.startsWith('{')) {
            try {
              const p = JSON.parse(trimmed);
              if (p.payer_id) parsedPayerId = p.payer_id;
              if (p.payer_name) parsedPayerName = p.payer_name;
              if (Array.isArray(p.splits) && p.splits.length > 0) metaSplits = p.splits;
              if (p.split_type) metaSplitType = p.split_type;
            } catch {}
          } else if (trimmed) {
            parsedPayerName = trimmed;
          }
        }

        // Prefer localExp.splits if it has more participants, otherwise expSplits, otherwise metaSplits from cloud JSON
        const bestSplits =
          localExp?.splits && localExp.splits.length >= expSplits.length
            ? localExp.splits
            : expSplits.length > 0
              ? expSplits
              : metaSplits;

        const resolvedPayerName =
          localExp?.payerName ||
          parsedPayerName ||
          (parsedPayerId && memberNameById.get(parsedPayerId)) ||
          exp.merchant_name ||
          (exp.paid_by && memberNameById.get(exp.paid_by)) ||
          'Member';

        const resolvedPaidBy =
          parsedPayerId ||
          localExp?.paid_by ||
          (exp.paid_by && memberNameById.has(exp.paid_by) ? exp.paid_by : undefined) ||
          exp.paid_by;

        return {
          ...exp,
          splits: bestSplits,
          payment_mode: exp.payment_mode || localExp?.payment_mode || 'upi',
          split_type: exp.split_type || metaSplitType || localExp?.split_type || 'equal',
          paid_by: resolvedPaidBy,
          payerName: resolvedPayerName,
        };
      });

      // Merge local expenses: DO NOT resurrect deleted expenses!
      const existingExpenses = localDetails?.expenses || [];
      const expMap = new Map<string, any>();
      enrichedExpenses.forEach(e => {
        if (!deletedExpenseIdsSet.has(e.id)) {
          expMap.set(e.id, { ...e, trip_id: e.trip_id || tripId });
        }
      });

      existingExpenses.forEach(e => {
        if (!e.id || deletedExpenseIdsSet.has(e.id)) return;
        // If it had a valid UUID (synced to Supabase), but Supabase didn't return it in expensesRaw,
        // then it was deleted in Supabase! Do NOT resurrect it.
        if (isValidUUID(e.id) && tripData && !expMap.has(e.id)) {
          return;
        }
        if (!expMap.has(e.id)) {
          expMap.set(e.id, { ...e, trip_id: e.trip_id || tripId });
        }
      });

      const finalExpenses = normalizeExpensesForTrip(Array.from(expMap.values()), finalMembers);
      const validExpenseIdSet = new Set(finalExpenses.map(e => e.id));

      // 9. Calculate balances using all merged & normalized splits
      const mergedSplits = finalExpenses.flatMap((e: any) => e.splits || []);
      const calculatedBalances = computeBalances(
        tripId,
        finalMembers,
        finalExpenses,
        mergedSplits
      );

      // 10. Messages: query BOTH trip_messages and messages concurrently
      let tripMsgs: any[] = [];
      let rawMsgs: any[] = [];
      try {
        const [tmRes, mRes] = await Promise.all([
          withTimeout(
            supabaseAdmin
              .from('trip_messages')
              .select('*')
              .eq('trip_id', tripId)
              .order('created_at', { ascending: true }),
            3500
          ).catch(() => ({ data: [] as any[] })),
          withTimeout(
            supabaseAdmin
              .from('messages')
              .select('*')
              .eq('trip_id', tripId)
              .order('created_at', { ascending: true }),
            3500
          ).catch(() => ({ data: [] as any[] })),
        ]);
        tripMsgs = tmRes.data || [];
        rawMsgs = mRes.data || [];
      } catch {}

      const enrichedMessages: TripMessage[] = [];
      const seenMsgIds = new Set<string>();

      // First add trip_messages (primary chat table)
      for (const tm of tripMsgs) {
        if (!tm.id || seenMsgIds.has(tm.id)) continue;
        const parsed = parseMessagePayload(tm.message || '');
        if (parsed.expId && (deletedExpenseIdsSet.has(parsed.expId) || !validExpenseIdSet.has(parsed.expId))) {
          continue;
        }
        seenMsgIds.add(tm.id);
        enrichedMessages.push({
          id: tm.id,
          trip_id: tm.trip_id || tripId,
          sender_id: tm.sender_id,
          sender_name: tm.sender_name || memberNameById.get(tm.sender_id) || 'Member',
          message: parsed.displayText,
          content: tm.message || '',
          type: parsed.msgType,
          chat_type: parsed.chatType || (tm.message?.includes('"chat_type":"user"') || tm.message?.includes('"chat_type":"individual"') ? 'individual' : defaultChatType),
          media_url: parsed.mediaUrl,
          media_name: parsed.mediaName,
          media_size: parsed.mediaSize,
          expense_id: parsed.expId,
          expense_data: parsed.expData,
          payload: parsed.rawPayload,
          is_sent: tm.is_sent !== undefined ? !!tm.is_sent : (parsed.is_sent !== undefined ? parsed.is_sent : true),
          is_seen: tm.is_seen !== undefined ? !!tm.is_seen : (parsed.is_seen !== undefined ? parsed.is_seen : false),
          is_edited: tm.is_edited !== undefined ? !!tm.is_edited : (parsed.is_edited !== undefined ? parsed.is_edited : false),
          seen_at: tm.seen_at || parsed.seen_at,
          created_at: tm.created_at,
        });
      }

      // Then add any additional from messages table
      for (const m of rawMsgs) {
        if (!m.id || seenMsgIds.has(m.id)) continue;
        const parsed = parseMessagePayload(m.content || '');
        if (parsed.expId && (deletedExpenseIdsSet.has(parsed.expId) || !validExpenseIdSet.has(parsed.expId))) {
          continue;
        }
        seenMsgIds.add(m.id);
        const metaChatType = m.metadata?.chat_type || parsed.chatType || defaultChatType;
        const resolvedChatType: 'group' | 'individual' =
          metaChatType === 'individual' || metaChatType === 'user' ? 'individual' : 'group';
        enrichedMessages.push({
          id: m.id,
          trip_id: m.trip_id || tripId,
          sender_id: m.sender_id,
          sender_name: memberNameById.get(m.sender_id) || 'Member',
          message: parsed.displayText,
          content: m.content || '',
          type: parsed.msgType,
          chat_type: resolvedChatType,
          media_url: parsed.mediaUrl,
          media_name: parsed.mediaName,
          media_size: parsed.mediaSize,
          expense_id: parsed.expId,
          expense_data: parsed.expData,
          is_sent: m.is_sent !== undefined ? !!m.is_sent : (parsed.is_sent !== undefined ? parsed.is_sent : true),
          is_seen: m.is_seen !== undefined ? !!m.is_seen : (parsed.is_seen !== undefined ? parsed.is_seen : false),
          is_edited: m.is_edited !== undefined ? !!m.is_edited : (parsed.is_edited !== undefined ? parsed.is_edited : false),
          seen_at: m.seen_at || parsed.seen_at,
          created_at: m.created_at,
        });
      }

      const existingMsgs = (localDetails?.messages || [])
        .map(m => {
          const parsed = parseMessagePayload(m.content || m.message || '');
          const localChatType = m.chat_type || parsed.chatType || defaultChatType;
          const resolvedChatType: 'group' | 'individual' =
            localChatType === 'individual' || localChatType === 'user' ? 'individual' : 'group';
          return {
            ...m,
            trip_id: m.trip_id || tripId,
            message: parsed.displayText,
            type: m.type || parsed.msgType,
            chat_type: resolvedChatType,
            expense_id: m.expense_id || parsed.expId,
            expense_data: m.expense_data || parsed.expData,
            is_sent: m.is_sent !== undefined ? !!m.is_sent : (parsed.is_sent !== undefined ? parsed.is_sent : true),
            is_seen: m.is_seen !== undefined ? !!m.is_seen : (parsed.is_seen !== undefined ? parsed.is_seen : false),
            is_edited: m.is_edited !== undefined ? !!m.is_edited : (parsed.is_edited !== undefined ? parsed.is_edited : false),
            seen_at: m.seen_at || parsed.seen_at,
          };
        })
        .filter(m => {
          if (m.trip_id && m.trip_id !== tripId) return false;
          const expId = m.expense_id || m.expense_data?.id;
          if (expId && (deletedExpenseIdsSet.has(expId) || !validExpenseIdSet.has(expId))) {
            return false;
          }
          return true;
        });

      existingMsgs.forEach(m => {
        if (!seenMsgIds.has(m.id)) {
          seenMsgIds.add(m.id);
          enrichedMessages.push(m);
        }
      });

      const finalMessages = enrichedMessages.sort(
        (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
      );

      // Persist merged details back to AppStorage
      try {
        await AppStorage.setItem(
          `@splityourtrip_local_details_${tripId}`,
          JSON.stringify({
            members: finalMembers,
            expenses: finalExpenses,
            messages: finalMessages,
          })
        );
      } catch {}

      set({
        activeTrip: mergedActiveTrip,
        members: finalMembers,
        expenses: finalExpenses,
        balances: calculatedBalances,
        messages: finalMessages,
        isLoading: false,
      });
    } catch (err: any) {
      console.log('loadTripDetails exception handled smoothly:', err?.message);
      set({ isLoading: false });
    } finally {
      delete tripDetailsInFlightPromises[tripId];
    }
  })();

  tripDetailsInFlightPromises[tripId] = fetchPromise;
  return fetchPromise;
},

  prefetchAllTripDetails: async (tripIds: string[]) => {
    if (!isSupabaseConfigured || !tripIds || tripIds.length === 0) return;
    const validIds = tripIds.filter(id => isValidUUID(id));
    if (validIds.length === 0) return;

    try {
      const [membersRes, expsRes] = await Promise.all([
        withTimeout(
          supabaseAdmin.from('trip_members').select('*').in('trip_id', validIds),
          4000
        ).catch(() => ({ data: [] as any[] })),
        withTimeout(
          supabaseAdmin.from('expenses').select('*').in('trip_id', validIds).order('created_at', { ascending: false }),
          4000
        ).catch(() => ({ data: [] as any[] })),
      ]);

      const allMembers = membersRes.data || [];
      const allExpenses = expsRes.data || [];
      const expIds = allExpenses.map((e: any) => e.id);

      let allSplits: any[] = [];
      if (expIds.length > 0) {
        const { data: spData } = await withTimeout(
          supabaseAdmin.from('expense_splits').select('*').in('expense_id', expIds),
          4000
        ).catch(() => ({ data: [] }));
        allSplits = spData || [];
      }

      for (const tId of validIds) {
        const tMembers = allMembers.filter((m: any) => m.trip_id === tId);
        const tExpenses = allExpenses.filter((e: any) => e.trip_id === tId);

        let localDetails: any = null;
        try {
          const raw = await AppStorage.getItem(`@splityourtrip_local_details_${tId}`);
          if (raw) localDetails = JSON.parse(raw);
        } catch {}

        const memberNameById = new Map<string, string>();
        tMembers.forEach((m: any) => {
          memberNameById.set(m.id, m.display_name);
          if (m.profile_id) memberNameById.set(m.profile_id, m.display_name);
        });

        const enrichedExps = tExpenses.map((exp: any) => {
          const localExp = (localDetails?.expenses || []).find((le: any) => le.id === exp.id);
          const splits = allSplits.filter((s: any) => s.expense_id === exp.id);
          let parsedPayerId: string | null = null;
          let parsedPayerName: string | null = null;
          let metaSplits: any[] = [];
          let metaSplitType: string | null = null;

          if (exp.merchant_name && typeof exp.merchant_name === 'string') {
            const trimmed = exp.merchant_name.trim();
            if (trimmed.startsWith('{')) {
              try {
                const p = JSON.parse(trimmed);
                if (p.payer_id) parsedPayerId = p.payer_id;
                if (p.payer_name) parsedPayerName = p.payer_name;
                if (Array.isArray(p.splits) && p.splits.length > 0) metaSplits = p.splits;
                if (p.split_type) metaSplitType = p.split_type;
              } catch {}
            } else if (trimmed) {
              parsedPayerName = trimmed;
            }
          }

          const bestSplits =
            localExp?.splits && localExp.splits.length >= splits.length
              ? localExp.splits
              : splits.length > 0
                ? splits
                : metaSplits;

          const resolvedPayerName =
            localExp?.payerName ||
            parsedPayerName ||
            (parsedPayerId && memberNameById.get(parsedPayerId)) ||
            exp.merchant_name ||
            (exp.paid_by && memberNameById.get(exp.paid_by)) ||
            'Member';
          const resolvedPaidBy =
            parsedPayerId ||
            localExp?.paid_by ||
            (exp.paid_by && memberNameById.has(exp.paid_by) ? exp.paid_by : undefined) ||
            exp.paid_by;
          return {
            ...exp,
            splits: bestSplits,
            payment_mode: exp.payment_mode || localExp?.payment_mode || 'upi',
            split_type: exp.split_type || metaSplitType || localExp?.split_type || 'equal',
            paid_by: resolvedPaidBy,
            payerName: resolvedPayerName,
          };
        });

        const localExpensesOnly = (localDetails?.expenses || []).filter(
          (le: any) => !enrichedExps.some((ee: any) => ee.id === le.id)
        );
        const mergedExps = [...enrichedExps, ...localExpensesOnly];

        const localMembersOnly = (localDetails?.members || []).filter(
          (lm: any) => !tMembers.some((tm: any) => tm.id === lm.id || (lm.profile_id && tm.profile_id === lm.profile_id))
        );
        const mergedMembers = [...tMembers, ...localMembersOnly];

        try {
          await AppStorage.setItem(
            `@splityourtrip_local_details_${tId}`,
            JSON.stringify({
              members: mergedMembers,
              expenses: mergedExps,
              messages: localDetails?.messages || [],
            })
          );
        } catch {}
      }
    } catch (e: any) {
      console.log('prefetchAllTripDetails notice:', e?.message);
    }
  },

  addGuestMember: async (tripId: string, displayName: string, phoneNumber?: string | null) => {
    return get().addMember({
      tripId,
      displayName,
      phoneNumber,
      isGuest: true,
    });
  },

  addMember: async (data: {
    tripId: string;
    displayName: string;
    phoneNumber?: string | null;
    profileId?: string | null;
    isGuest?: boolean;
  }) => {
    const memberId = generateUUID();
    let finalProfileId = data.profileId || null;
    const finalPhone = data.phoneNumber ? data.phoneNumber.trim() : null;
    const contactName = getContactNameByPhone(finalPhone);
    let finalDisplayName = contactName || data.displayName.trim();

    // Database lookup: If phoneNumber provided without profileId, check if already in database
    if (finalPhone && !finalProfileId && isSupabaseConfigured) {
      try {
        const dbLookup = await get().findContactByPhone(finalPhone);
        if (dbLookup) {
          if (dbLookup.profileId) {
            finalProfileId = dbLookup.profileId;
          }
          if (!contactName && dbLookup.name && (!finalDisplayName || finalDisplayName === finalPhone || finalDisplayName.toLowerCase() === 'guest' || finalDisplayName.toLowerCase() === 'member')) {
            finalDisplayName = dbLookup.name;
          }
        }
      } catch {}
    }

    const isGuest =
      data.isGuest !== undefined
        ? Boolean(data.isGuest && !finalProfileId)
        : Boolean(!finalProfileId && !finalPhone);

    const newMember: TripMember = {
      id: memberId,
      trip_id: data.tripId,
      profile_id: finalProfileId || undefined,
      user_id: finalProfileId || null,
      display_name: finalDisplayName,
      phone_number: finalPhone,
      role: 'member',
      status: 'accepted',
      is_guest: isGuest,
      created_at: new Date().toISOString(),
    };

    // Read existing members for THIS specific tripId from AppStorage + active state
    let existingTripMembers = get().members.filter(m => m.trip_id === data.tripId);
    let storedDetails: any = {};
    try {
      const raw = await AppStorage.getItem(`@splityourtrip_local_details_${data.tripId}`);
      if (raw) {
        storedDetails = JSON.parse(raw);
        if (Array.isArray(storedDetails.members) && storedDetails.members.length > existingTripMembers.length) {
          existingTripMembers = storedDetails.members;
        }
      }
    } catch {}

    // Filter out if duplicate already exists
    const isDuplicate = existingTripMembers.some(
      m => (finalProfileId && m.profile_id === finalProfileId) ||
           (m.id === newMember.id)
    );
    if (isDuplicate) {
      return null;
    }

    const currentMembers = [...existingTripMembers, newMember];
    const currentExpenses = normalizeExpensesForTrip(
      storedDetails.expenses || get().expenses.filter(e => e.trip_id === data.tripId),
      currentMembers
    );
    const newBalances = computeBalances(
      data.tripId,
      currentMembers,
      currentExpenses,
      currentExpenses.flatMap((e: any) => e.splits || [])
    );

    set({ members: currentMembers, expenses: currentExpenses, balances: newBalances });

    // Persist locally immediately
    try {
      storedDetails.members = currentMembers;
      storedDetails.expenses = currentExpenses;
      await AppStorage.setItem(`@splityourtrip_local_details_${data.tripId}`, JSON.stringify(storedDetails));
    } catch {}

    // Sync to Supabase directly and await with timeout
    if (isSupabaseConfigured && isValidUUID(data.tripId)) {
      try {
        const validProfileId = finalProfileId && isValidUUID(finalProfileId) ? finalProfileId : null;
        const memberPayload = {
          id: memberId,
          trip_id: data.tripId,
          profile_id: validProfileId,
          user_id: validProfileId,
          display_name: finalDisplayName,
          phone_number: finalPhone,
          role: 'member',
          status: 'accepted',
          is_guest: isGuest,
        };

        const adminRes = await withTimeout(
          supabaseAdmin.from('trip_members').upsert(memberPayload, { onConflict: 'id' }),
          3500
        ).catch(() => null);

        if (!adminRes || adminRes.error) {
          await withTimeout(
            supabase.from('trip_members').upsert(memberPayload, { onConflict: 'id' }),
            3000
          ).catch(() => null);
        }
      } catch (err: any) {
        console.log('addMember Supabase notice:', err?.message);
      }
    }

    // Save or update contact in useContactsStore
    if (finalPhone) {
      try {
        const { useContactsStore } = require('../contacts/useContactsStore');
        useContactsStore.getState().addManualFriend(
          finalDisplayName,
          finalPhone,
          finalProfileId || undefined,
          Boolean(finalProfileId)
        );
      } catch {}
    }

    return newMember;
  },

  removeMember: async (tripId: string, memberId: string) => {
    let currentMembers = get().members.filter(m => m.id !== memberId);
    let storedDetails: any = {};
    try {
      const raw = await AppStorage.getItem(`@splityourtrip_local_details_${tripId}`);
      if (raw) {
        storedDetails = JSON.parse(raw);
        if (Array.isArray(storedDetails.members)) {
          storedDetails.members = storedDetails.members.filter((m: any) => m.id !== memberId);
        }
      }
    } catch {}

    const currentExpenses = normalizeExpensesForTrip(
      storedDetails.expenses || get().expenses.filter(e => e.trip_id === tripId),
      currentMembers
    );
    const newBalances = computeBalances(
      tripId,
      currentMembers,
      currentExpenses,
      currentExpenses.flatMap((e: any) => e.splits || [])
    );

    set({ members: currentMembers, expenses: currentExpenses, balances: newBalances });

    try {
      storedDetails.members = currentMembers;
      storedDetails.expenses = currentExpenses;
      await AppStorage.setItem(`@splityourtrip_local_details_${tripId}`, JSON.stringify(storedDetails));
    } catch {}

    if (isSupabaseConfigured && isValidUUID(memberId)) {
      try {
        await withTimeout(
          supabaseAdmin.from('trip_members').delete().eq('id', memberId),
          3500
        ).catch(() => null);
      } catch (e) {
        console.warn('removeMember Supabase notice:', e);
      }
    }

    return true;
  },

  findContactByPhone: async (rawPhone: string) => {
    if (!rawPhone || !rawPhone.trim()) return null;
    const cleanDigits = rawPhone.replace(/[^0-9]/g, '');
    if (cleanDigits.length < 4) return null;
    const last10 = cleanDigits.length >= 10 ? cleanDigits.slice(-10) : cleanDigits;

    const authState = useAuthStore.getState();
    const currentUserId = authState.user?.id || authState.profile?.id;
    const currentUserPhone = normalizePhone(
      authState.profile?.phone_number || (authState.user as any)?.phone || (authState.user as any)?.user_metadata?.phone_number
    );

    // CRITICAL: Do not match if the phone number belongs to the active user!
    if (currentUserPhone && currentUserPhone.length >= 6 && last10 === currentUserPhone.slice(-10)) {
      return null;
    }

    // 0. Always check device contact name first
    const localContactName = getContactNameByPhone(rawPhone);

    // 1. Check Supabase profiles table (registered app users)
    if (isSupabaseConfigured) {
      try {
        let profQuery = supabaseAdmin
          .from('profiles')
          .select('id, full_name, phone_number, avatar_url')
          .or(`phone_number.ilike.%${last10}%,phone_number.ilike.%${cleanDigits}%`);

        if (currentUserId && isValidUUID(currentUserId)) {
          profQuery = profQuery.neq('id', currentUserId);
        }

        const { data: profiles } = await withTimeout(
          profQuery.limit(1),
          3000
        ).catch(() => ({ data: null } as any));

        if (profiles && profiles.length > 0 && profiles[0].id) {
          const p = profiles[0];
          if (p.id !== currentUserId) {
            const bestContactName =
              localContactName ||
              getContactNameByPhone(p.phone_number) ||
              (p.full_name && p.full_name.trim() !== 'Split Your Trip User' ? p.full_name : null) ||
              'Split Your Trip User';

            return {
              profileId: p.id,
              name: bestContactName,
              phoneNumber: p.phone_number || rawPhone,
              avatarUrl: p.avatar_url || null,
              isAppUser: true,
            };
          }
        }
      } catch (e) {
        console.warn('findContactByPhone profiles notice:', e);
      }

      // 2. Check Supabase trip_members table for previously linked members with this number
      try {
        let memQuery = supabaseAdmin
          .from('trip_members')
          .select('id, display_name, phone_number, profile_id')
          .or(`phone_number.ilike.%${last10}%,phone_number.ilike.%${cleanDigits}%`)
          .not('display_name', 'is', null)
          .order('created_at', { ascending: false });

        if (currentUserId && isValidUUID(currentUserId)) {
          memQuery = memQuery.neq('profile_id', currentUserId);
        }

        const { data: members } = await withTimeout(
          memQuery.limit(2),
          3000
        ).catch(() => ({ data: null } as any));

        const nonSelfMember = (members || []).find(
          (m: any) => !currentUserId || m.profile_id !== currentUserId
        );

        if (nonSelfMember && nonSelfMember.display_name && nonSelfMember.display_name.trim() !== 'Member') {
          const m = nonSelfMember;
          const bestContactName =
            localContactName ||
            getContactNameByPhone(m.phone_number) ||
            m.display_name.trim();

          return {
            profileId: m.profile_id || undefined,
            name: bestContactName,
            phoneNumber: m.phone_number || rawPhone,
            isAppUser: Boolean(m.profile_id),
          };
        }
      } catch (e) {
        console.warn('findContactByPhone trip_members notice:', e);
      }
    }

    // 3. Fallback: check useContactsStore (cached contacts)
    try {
      const { useContactsStore } = require('../contacts/useContactsStore');
      const contacts = useContactsStore.getState().contacts;
      const matched = contacts.find((c: any) => {
        if (!c.phoneNumber) return false;
        const cDigits = c.phoneNumber.replace(/[^0-9]/g, '');
        return (
          cDigits.includes(last10) ||
          cleanDigits.includes(cDigits.slice(-10))
        );
      });
      if (matched && matched.name) {
        return {
          profileId: matched.profileId || undefined,
          name: localContactName || matched.name,
          phoneNumber: matched.phoneNumber,
          avatarUrl: matched.avatarUrl || null,
          isAppUser: Boolean(matched.profileId || matched.isRegistered),
        };
      }
    } catch {}

    if (localContactName) {
      return {
        name: localContactName,
        phoneNumber: rawPhone,
        isAppUser: false,
      };
    }

    return null;
  },

  searchRegisteredUsers: async (query: string) => {
    if (!isSupabaseConfigured || !query || query.trim().length < 2) return [];
    const cleanQuery = query.trim();
    const cleanDigits = cleanQuery.replace(/[^0-9]/g, '');

    try {
      let queryBuilder = supabase
        .from('profiles')
        .select('id, full_name, phone_number, avatar_url')
        .limit(10);

      if (cleanDigits.length >= 3) {
        queryBuilder = queryBuilder.or(`full_name.ilike.%${cleanQuery}%,phone_number.ilike.%${cleanDigits}%`);
      } else {
        queryBuilder = queryBuilder.ilike('full_name', `%${cleanQuery}%`);
      }

      const { data, error } = await queryBuilder;
      if (error) {
        console.log('searchRegisteredUsers error:', error.message);
        return [];
      }
      return (data || []).map(p => ({
        id: p.id,
        full_name: p.full_name || 'Split Your Trip User',
        phone_number: p.phone_number || null,
        avatar_url: p.avatar_url || null,
      }));
    } catch (e: any) {
      console.log('searchRegisteredUsers exception:', e?.message);
      return [];
    }
  },

  generateInviteCode: async (tripId: string, _userId: string) => {
    return tripId.replace(/-/g, '').substring(0, 6).toUpperCase();
  },

  joinTripByCode: async (code: string, userId: string, _userName: string) => {
    if (!isSupabaseConfigured || !isValidUUID(userId)) return true;

    try {
      const { data: matchingTrips } = await supabase
        .from('trips')
        .select('id')
        .ilike('id', `${code.toLowerCase().trim()}%`)
        .limit(1);

      if (!matchingTrips || matchingTrips.length === 0) {
        return false;
      }

      const targetTripId = matchingTrips[0].id;

      const authState = useAuthStore.getState();
      const userPhone =
        authState.profile?.phone_number ||
        (authState.user as any)?.phone ||
        (authState.user as any)?.user_metadata?.phone_number ||
        null;
      const resolvedName = _userName || authState.profile?.full_name || authState.profile?.name || 'Traveler';

      await supabaseAdmin.from('trip_members').upsert(
        {
          trip_id: targetTripId,
          profile_id: userId,
          user_id: userId,
          display_name: resolvedName,
          phone_number: userPhone,
          role: 'member',
          status: 'accepted',
          is_guest: false,
        },
        { onConflict: 'trip_id,profile_id' }
      );

      await get().fetchTrips(userId);
      return true;
    } catch {
      return false;
    }
  },

  addExpense: async data => {
    const {
      tripId,
      paidByMemberId,
      amountPaise,
      description,
      category = 'General',
      paymentMode,
      splitType,
      participantMemberIds,
      customSplits,
      userId,
    } = data;

    // Calculate splits
    let computedSplits: Array<{ memberId: string; shareAmount: number }> = [];
    if (splitType === 'equal') {
      computedSplits = splitEqual(amountPaise, participantMemberIds);
    } else if (customSplits) {
      computedSplits = customSplits;
    }

    // Filter members for THIS trip to avoid picking a member from a different trip
    const tripScopeMembers = get().members.filter(m => m.trip_id === tripId);
    const payerMember = (tripScopeMembers.length > 0 ? tripScopeMembers : get().members).find(
      m => m.id === paidByMemberId || m.profile_id === paidByMemberId
    );
    const payerName = payerMember?.display_name || 'Member';
    const payerProfileId = payerMember?.profile_id || userId;

    const newExpenseId = generateUUID();
    const creatorId = userId || payerProfileId || payerMember?.id || 'local_user';
    const localExpense = {
      id: newExpenseId,
      trip_id: tripId,
      paid_by: payerMember?.id || paidByMemberId,
      created_by: creatorId,
      amount: amountPaise,
      description: description.trim(),
      category: category || 'General',
      payment_mode: paymentMode,
      split_type: splitType,
      currency: 'INR',
      date: new Date().toISOString(),
      created_at: new Date().toISOString(),
      location: data.location || null,
      latitude: data.latitude || null,
      longitude: data.longitude || null,
      attachment_url: data.attachmentUrl || null,
      attachment_name: data.attachmentName || null,
      attachment_type: data.attachmentType || null,
      splits: computedSplits.map(s => ({
        id: generateUUID(),
        expense_id: newExpenseId,
        member_id: s.memberId,
        amount: s.shareAmount,
      })),
      payerName,
    };

    let insertedInCloud = false;

    // Cloud insert if configured
    if (isSupabaseConfigured && isValidUUID(tripId)) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const activeUserId =
          session?.user?.id ||
          (userId && isValidUUID(userId) ? userId : null) ||
          useAuthStore.getState().user?.id;

        if (activeUserId) {
          // 1. Verify trip exists in Supabase, auto-sync if missing
          const { data: tripExists } = await supabaseAdmin
            .from('trips')
            .select('id')
            .eq('id', tripId)
            .maybeSingle();

          if (!tripExists) {
            const localTrip = get().trips.find(t => t.id === tripId) || get().activeTrip;
            if (localTrip) {
              const tripInvite = (localTrip as any).invite_code || Math.random().toString(36).substring(2, 8).toUpperCase();
              await supabaseAdmin.from('trips').upsert({
                id: tripId,
                name: localTrip.name,
                description: localTrip.description || '',
                trip_type: localTrip.trip_type || 'group',
                friend_id: localTrip.friend_id || null,
                image_url: localTrip.image_url || null,
                currency: localTrip.currency || 'INR',
                status: 'active',
                invite_code: tripInvite,
                created_by: activeUserId,
              }, { onConflict: 'id' });

              const authState = useAuthStore.getState();
              const userName = authState.profile?.full_name || authState.profile?.name || (authState.user as any)?.email?.split('@')[0] || 'Member';
              await supabaseAdmin.from('trip_members').upsert({
                trip_id: tripId,
                profile_id: activeUserId,
                user_id: activeUserId,
                display_name: userName,
                role: 'admin',
                status: 'accepted',
                is_guest: false,
              }, { onConflict: 'id' });
            }
          }

          // 2. Determine valid paid_by UUID (Postgres foreign key requires an auth.users id)
          const tripObj = get().trips.find(t => t.id === tripId) || get().activeTrip;
          const guaranteedAuthUserId =
            activeUserId ||
            (tripObj?.created_by && isValidUUID(tripObj.created_by) ? tripObj.created_by : null) ||
            'c190b7ba-767d-4c0e-9ec5-53ecd91d06c5';

          let validPaidBy = guaranteedAuthUserId;
          if (payerProfileId && isValidUUID(payerProfileId)) {
            try {
              const { data: userCheck } = await supabaseAdmin.auth.admin.getUserById(payerProfileId);
              if (userCheck?.user?.id) {
                validPaidBy = userCheck.user.id;
              }
            } catch {}
          }

          const structuredMerchantJson = JSON.stringify({
            payer_name: payerName,
            payer_id: payerMember?.id || paidByMemberId,
            split_type: splitType || 'equal',
            splits: computedSplits.map(s => {
              const participant = (tripScopeMembers.length > 0 ? tripScopeMembers : get().members).find(m => m.id === s.memberId);
              return {
                member_id: s.memberId,
                profile_id: participant?.profile_id || null,
                display_name: participant?.display_name || 'Member',
                amount: s.shareAmount,
              };
            }),
          });

          const expensePayload = {
            id: newExpenseId,
            trip_id: tripId,
            amount: amountPaise,
            paid_by: validPaidBy,
            merchant_name: structuredMerchantJson,
            expense_type: 'manual',
            upi_txn_id: data.upiTxnId || null,
            description: description.trim(),
            category: category || 'General',
            payment_mode: paymentMode || 'upi',
            split_type: splitType || 'equal',
            currency: 'INR',
            date: new Date().toISOString(),
            expense_date: new Date().toISOString(),
            attachment_url: data.attachmentUrl || null,
            attachment_name: data.attachmentName || null,
            attachment_type: data.attachmentType || null,
            location: data.location || null,
            latitude: data.latitude || null,
            longitude: data.longitude || null,
            created_by: guaranteedAuthUserId,
          };

          let { data: expData, error: expError } = await supabaseAdmin
            .from('expenses')
            .upsert(expensePayload, { onConflict: 'id' })
            .select()
            .single();

          if (expError && guaranteedAuthUserId !== validPaidBy) {
            console.warn('Expense foreign key retry with guaranteed auth user:', expError.message);
            const retryRes = await supabaseAdmin
              .from('expenses')
              .upsert({ ...expensePayload, paid_by: guaranteedAuthUserId }, { onConflict: 'id' })
              .select()
              .single();
            expData = retryRes.data;
            expError = retryRes.error;
          }

          if (!expError && expData) {
            insertedInCloud = true;
            if (computedSplits.length > 0) {
              const splitInserts = computedSplits.map(s => {
                const participant = (tripScopeMembers.length > 0 ? tripScopeMembers : get().members).find(m => m.id === s.memberId);
                const participantProfileId =
                  participant?.profile_id && isValidUUID(participant.profile_id)
                    ? participant.profile_id
                    : null;
                const memberUuid = isValidUUID(s.memberId) ? s.memberId : null;
                return {
                  id: generateUUID(),
                  expense_id: expData.id,
                  profile_id: participantProfileId,
                  member_id: memberUuid,
                  amount: s.shareAmount,
                  share_amount: s.shareAmount,
                  share_type: 'equal',
                };
              });

              if (splitInserts.length > 0) {
                await supabaseAdmin.from('expense_splits').upsert(splitInserts, { onConflict: 'id' });
              }
            }
          } else if (expError) {
            console.warn('Expense Supabase insert notice:', expError.message);
          }
        }
      } catch (e: any) {
        console.log('Expense cloud insert fallback locally:', e?.message);
      }
    }

    // Read existing details for THIS specific tripId so we never mix expenses across different trips
    let storedDetails: any = {};
    try {
      const raw = await AppStorage.getItem(`@splityourtrip_local_details_${tripId}`);
      if (raw) {
        storedDetails = JSON.parse(raw);
      }
    } catch {}

    const tripMembers: TripMember[] =
      (Array.isArray(storedDetails.members) && storedDetails.members.length > 0
        ? storedDetails.members
        : get().members.filter(m => m.trip_id === tripId));

    const prevTripExpenses: any[] =
      Array.isArray(storedDetails.expenses)
        ? storedDetails.expenses
        : get().expenses.filter(e => e.trip_id === tripId);

    const updatedExpenses = normalizeExpensesForTrip(
      [localExpense, ...prevTripExpenses.filter(e => e.id !== newExpenseId)],
      tripMembers
    );

    const updatedBalances = computeBalances(
      tripId,
      tripMembers,
      updatedExpenses,
      updatedExpenses.flatMap((e: any) => e.splits || [])
    );

    set({
      members: tripMembers,
      expenses: updatedExpenses,
      balances: updatedBalances,
    });

    try {
      storedDetails.members = tripMembers;
      storedDetails.expenses = updatedExpenses;
      await AppStorage.setItem(`@splityourtrip_local_details_${tripId}`, JSON.stringify(storedDetails));
    } catch {}

    // Automatically send an expense notification chat message from the user
    try {
      const trip = get().trips.find(t => t.id === tripId);
      const formattedAmount = formatCurrencyAmount(amountPaise, trip?.currency || 'INR');
      const summaryText = `💰 Added expense: "${description.trim()}" for ${formattedAmount} (Paid by ${payerName})`;

      const isFriend = trip?.trip_type === 'friend_split';
      const expensePayload = JSON.stringify({
        type: 'expense',
        text: summaryText,
        chat_type: isFriend ? 'user' : 'trip',
        expense_id: newExpenseId,
        expense_data: {
          id: newExpenseId,
          description: description.trim(),
          amount: amountPaise,
          currency: trip?.currency || 'INR',
          paid_by_name: payerName,
          paid_by_id: payerMember?.id || paidByMemberId,
          created_by: creatorId,
          split_count: participantMemberIds.length,
          category: category || 'General',
          location: data.location || null,
          latitude: data.latitude || null,
          longitude: data.longitude || null,
          attachment_url: data.attachmentUrl || null,
          attachment_name: data.attachmentName || null,
          attachment_type: data.attachmentType || null,
          date: new Date().toISOString(),
        },
      });

      // Always send notification as the current user who is creating the expense.
      // The "paid by" info is already embedded in expense_data for display purposes.
      const authState = useAuthStore.getState();
      const creatorName = authState.profile?.full_name || authState.profile?.name || payerName;
      await get().sendMessage(tripId, creatorId, creatorName, expensePayload);
    } catch (e: any) {
      console.log('Auto-chat notification error handled:', e?.message);
    }

    // Recompute friend balances in background so Friends list is always synchronized
    try {
      const { useContactsStore } = require('../contacts/useContactsStore');
      const allTrips = get().trips;
      useContactsStore.getState().computeFriendBalances(allTrips, userId).catch(() => {});
      useContactsStore.getState().fetchFriendsSummary(userId).catch(() => {});
    } catch {}

    return true;
  },

  updateExpense: async data => {
    const {
      tripId,
      expenseId,
      amountPaise,
      description,
      category = 'General',
      paidByMemberId,
      paymentMode = 'upi',
      splitType = 'equal',
      participantMemberIds = [],
      customSplits,
      userId,
      editorName,
    } = data;

    const currentExpenses = get().expenses;
    const existingExpense = currentExpenses.find(e => e.id === expenseId);
    if (!existingExpense) return false;

    const targetPaidBy = paidByMemberId || existingExpense.paid_by;
    const targetParticipants: string[] =
      participantMemberIds && participantMemberIds.length > 0
        ? participantMemberIds
        : (existingExpense.splits?.map(s => s.member_id).filter(Boolean) as string[]) ||
          get().members.map(m => m.id);

    let computedSplits: Array<{ memberId: string; shareAmount: number }> = [];
    if (splitType === 'equal') {
      computedSplits = splitEqual(amountPaise, targetParticipants);
    } else if (customSplits && customSplits.length > 0) {
      computedSplits = customSplits;
    } else {
      computedSplits = splitEqual(amountPaise, targetParticipants);
    }

    const tripScopeMembers = get().members.filter(m => m.trip_id === tripId);
    const payerMember = (tripScopeMembers.length > 0 ? tripScopeMembers : get().members).find(
      m => m.id === targetPaidBy || m.profile_id === targetPaidBy
    );
    const payerName = payerMember?.display_name || existingExpense.payerName || 'Member';
    const payerProfileId = payerMember?.profile_id || userId;

    const updatedExpense = {
      ...existingExpense,
      amount: amountPaise,
      description: description.trim(),
      category,
      paid_by: targetPaidBy,
      payment_mode: paymentMode,
      split_type: splitType,
      payerName,
      location: data.location !== undefined ? data.location : existingExpense.location,
      latitude: data.latitude !== undefined ? data.latitude : existingExpense.latitude,
      longitude: data.longitude !== undefined ? data.longitude : existingExpense.longitude,
      attachment_url: data.attachmentUrl !== undefined ? data.attachmentUrl : existingExpense.attachment_url,
      attachment_name: data.attachmentName !== undefined ? data.attachmentName : existingExpense.attachment_name,
      attachment_type: data.attachmentType !== undefined ? data.attachmentType : existingExpense.attachment_type,
      splits: computedSplits.map(s => ({
        id: generateUUID(),
        expense_id: expenseId,
        member_id: s.memberId,
        amount: s.shareAmount,
      })),
    };

    const newExpenses = currentExpenses.map(e => (e.id === expenseId ? updatedExpense : e));
    const newBalances = computeBalances(
      tripId,
      get().members,
      newExpenses,
      newExpenses.flatMap(e => e.splits || [])
    );

    set({ expenses: newExpenses, balances: newBalances });

    // Persist locally
    try {
      const raw = await AppStorage.getItem(`@splityourtrip_local_details_${tripId}`);
      const details = raw ? JSON.parse(raw) : {};
      details.expenses = newExpenses;
      await AppStorage.setItem(`@splityourtrip_local_details_${tripId}`, JSON.stringify(details));
    } catch {}

    // Cloud update if configured
    if (isSupabaseConfigured && isValidUUID(tripId) && isValidUUID(expenseId)) {
      try {
        const tripObj = get().trips.find(t => t.id === tripId) || get().activeTrip;
        const guaranteedAuthUserId =
          (useAuthStore.getState().user?.id && isValidUUID(useAuthStore.getState().user?.id)
            ? useAuthStore.getState().user?.id
            : null) ||
          (tripObj?.created_by && isValidUUID(tripObj.created_by) ? tripObj.created_by : null) ||
          'c190b7ba-767d-4c0e-9ec5-53ecd91d06c5';

        let validPaidBy = guaranteedAuthUserId;
        if (payerProfileId && isValidUUID(payerProfileId)) {
          try {
            const { data: userCheck } = await supabaseAdmin.auth.admin.getUserById(payerProfileId);
            if (userCheck?.user?.id) {
              validPaidBy = userCheck.user.id;
            }
          } catch {}
        }

        await supabaseAdmin
          .from('expenses')
          .update({
            amount: amountPaise,
            description: description.trim(),
            category,
            paid_by: validPaidBy,
            merchant_name: JSON.stringify({
              payer_name: payerName,
              payer_id: targetPaidBy,
              split_type: splitType,
              splits: computedSplits.map(s => {
                const participant = (tripScopeMembers.length > 0 ? tripScopeMembers : get().members).find(m => m.id === s.memberId);
                return {
                  member_id: s.memberId,
                  profile_id: participant?.profile_id || null,
                  display_name: participant?.display_name || 'Member',
                  amount: s.shareAmount,
                };
              }),
            }),
            expense_type: 'manual',
            payment_mode: paymentMode,
            split_type: splitType,
            location: data.location !== undefined ? data.location : undefined,
            latitude: data.latitude !== undefined ? data.latitude : undefined,
            longitude: data.longitude !== undefined ? data.longitude : undefined,
            attachment_url: data.attachmentUrl !== undefined ? data.attachmentUrl : undefined,
            attachment_name: data.attachmentName !== undefined ? data.attachmentName : undefined,
            attachment_type: data.attachmentType !== undefined ? data.attachmentType : undefined,
          })
          .eq('id', expenseId);

        await supabaseAdmin.from('expense_splits').delete().eq('expense_id', expenseId);
        if (computedSplits.length > 0) {
          const splitInserts = computedSplits.map(s => {
            const participant = (tripScopeMembers.length > 0 ? tripScopeMembers : get().members).find(m => m.id === s.memberId);
            const participantProfileId =
              participant?.profile_id && isValidUUID(participant.profile_id)
                ? participant.profile_id
                : null;
            const memberUuid = isValidUUID(s.memberId) ? s.memberId : null;
            return {
              id: generateUUID(),
              expense_id: expenseId,
              profile_id: participantProfileId,
              member_id: memberUuid,
              amount: s.shareAmount,
              share_amount: s.shareAmount,
              share_type: 'equal',
            };
          });

          if (splitInserts.length > 0) {
            await supabaseAdmin.from('expense_splits').insert(splitInserts);
          }
        }
      } catch (err: any) {
        console.log('updateExpense cloud update notice:', err?.message);
      }
    }

    // Update existing chat message for this expense in place (do not send a new message!)
    try {
      const trip = get().trips.find(t => t.id === tripId);
      const currentMessages = get().messages;
      const existingMsgIndex = currentMessages.findIndex(
        m =>
          m.expense_id === expenseId ||
          m.expense_data?.id === expenseId ||
          (m.message && (m.message.includes(`"expense_id":"${expenseId}"`) || m.message.includes(`"id":"${expenseId}"`)))
      );

      const formattedAmount = formatCurrencyAmount(amountPaise, trip?.currency || 'INR');
      const updateSummary = `✏️ ${editorName} updated bill: "${description.trim()}" (${formattedAmount})`;

      const updatedExpenseData = {
        id: expenseId,
        trip_id: tripId,
        trip_name: trip?.name || 'Trip',
        description: description.trim(),
        amount: amountPaise,
        currency: trip?.currency || 'INR',
        paid_by_name: payerName,
        paid_by_id: targetPaidBy,
        split_count: targetParticipants.length,
        category,
        location: data.location !== undefined ? data.location : existingExpense.location,
        latitude: data.latitude !== undefined ? data.latitude : existingExpense.latitude,
        longitude: data.longitude !== undefined ? data.longitude : existingExpense.longitude,
        attachment_url: data.attachmentUrl !== undefined ? data.attachmentUrl : existingExpense.attachment_url,
        attachment_name: data.attachmentName !== undefined ? data.attachmentName : existingExpense.attachment_name,
        attachment_type: data.attachmentType !== undefined ? data.attachmentType : existingExpense.attachment_type,
        date: existingExpense.date || new Date().toISOString(),
      };

      const isFriend = trip?.trip_type === 'friend_split';
      const updatedPayload = JSON.stringify({
        type: 'expense',
        text: updateSummary,
        chat_type: isFriend ? 'user' : 'trip',
        expense_id: expenseId,
        expense_data: updatedExpenseData,
      });

      if (existingMsgIndex >= 0) {
        const existingMsg = currentMessages[existingMsgIndex];
        const updatedMsg: TripMessage = {
          ...existingMsg,
          message: updatedPayload,
          content: updatedPayload,
          chat_type: isFriend ? 'user' : 'trip',
          expense_id: expenseId,
          expense_data: updatedExpenseData,
        };

        const newMessages = [...currentMessages];
        newMessages[existingMsgIndex] = updatedMsg;
        set({ messages: newMessages });

        // Update local storage
        try {
          const raw = await AppStorage.getItem(`@splityourtrip_local_details_${tripId}`);
          if (raw) {
            const details = JSON.parse(raw);
            details.messages = newMessages;
            await AppStorage.setItem(`@splityourtrip_local_details_${tripId}`, JSON.stringify(details));
          }
        } catch {}

        // Cloud update if configured
        if (isSupabaseConfigured && isValidUUID(existingMsg.id)) {
          try {
            await supabaseAdmin
              .from('trip_messages')
              .update({
                message: updatedPayload,
              })
              .eq('id', existingMsg.id);
            await supabaseAdmin
              .from('messages')
              .update({
                content: updatedPayload,
              })
              .eq('id', existingMsg.id);
          } catch {}
        }
      } else {
        // Fallback: only if no message previously existed
        await get().sendMessage(tripId, userId, editorName, updatedPayload);
      }
    } catch (e) {
      console.log('updateExpense message sync notice:', e);
    }

    // Recompute friend balances so Friends list stays in sync
    try {
      const { useContactsStore } = require('../contacts/useContactsStore');
      useContactsStore.getState().computeFriendBalances(get().trips, userId).catch(() => {});
      useContactsStore.getState().fetchFriendsSummary(userId).catch(() => {});
    } catch {}

    return true;
  },

  deleteExpense: async (tripId: string, expenseId: string, deleterName?: string) => {
    // 1. Mark in tombstone blacklist immediately so no sync ever resurrects it
    markExpenseDeleted(expenseId);

    const currentExpenses = get().expenses;
    const newExpenses = currentExpenses.filter(e => e.id !== expenseId);

    // Completely purge any messages referencing this expense
    const currentMessages = get().messages;
    const newMessages = currentMessages.filter(
      m =>
        m.id !== expenseId &&
        m.id !== `group_exp_${expenseId}` &&
        m.id !== `shared_exp_${expenseId}` &&
        m.expense_id !== expenseId &&
        m.expense_data?.id !== expenseId &&
        !m.message?.includes(expenseId) &&
        !m.content?.includes(expenseId)
    );

    // Recalculate balances
    const newBalances = computeBalances(
      tripId,
      get().members,
      newExpenses,
      newExpenses.flatMap(e => e.splits || [])
    );

    set({ expenses: newExpenses, messages: newMessages, balances: newBalances });

    // Update local storage across all trips to clean up any references
    try {
      const allTrips = get().trips;
      for (const t of allTrips) {
        const raw = await AppStorage.getItem(`@splityourtrip_local_details_${t.id}`);
        if (raw) {
          const details = JSON.parse(raw);
          let changed = false;
          if (Array.isArray(details.expenses) && details.expenses.some((e: any) => e.id === expenseId)) {
            details.expenses = details.expenses.filter((e: any) => e.id !== expenseId);
            changed = true;
          }
          if (Array.isArray(details.messages) && details.messages.some((m: any) =>
            m.id === expenseId ||
            m.id === `group_exp_${expenseId}` ||
            m.id === `shared_exp_${expenseId}` ||
            m.expense_id === expenseId ||
            m.expense_data?.id === expenseId ||
            m.message?.includes(expenseId) ||
            m.content?.includes(expenseId)
          )) {
            details.messages = details.messages.filter((m: any) =>
              m.id !== expenseId &&
              m.id !== `group_exp_${expenseId}` &&
              m.id !== `shared_exp_${expenseId}` &&
              m.expense_id !== expenseId &&
              m.expense_data?.id !== expenseId &&
              !m.message?.includes(expenseId) &&
              !m.content?.includes(expenseId)
            );
            changed = true;
          }
          if (changed) {
            await AppStorage.setItem(`@splityourtrip_local_details_${t.id}`, JSON.stringify(details));
          }
        }
      }
    } catch {}

    // Cloud delete if configured
    if (isSupabaseConfigured && isValidUUID(expenseId)) {
      try {
        await supabaseAdmin.from('expense_splits').delete().eq('expense_id', expenseId);
        await supabaseAdmin.from('expenses').delete().eq('id', expenseId);
        await supabaseAdmin.from('trip_messages').delete().eq('id', expenseId);
        await supabaseAdmin.from('trip_messages').delete().ilike('message', `%${expenseId}%`);
        await supabaseAdmin.from('messages').delete().ilike('content', `%${expenseId}%`);
      } catch (err: any) {
        console.log('deleteExpense cloud notice:', err?.message);
      }
    }

    // Recompute friend balances so Friends list stays in sync
    try {
      const { useContactsStore } = require('../contacts/useContactsStore');
      const { useAuthStore } = require('../auth/useAuthStore');
      const activeId = useAuthStore.getState().user?.id;
      useContactsStore.getState().computeFriendBalances(get().trips, activeId).catch(() => {});
      useContactsStore.getState().fetchFriendsSummary(activeId).catch(() => {});
    } catch {}

    return true;
  },

  reportExpense: async data => {
    const { tripId, expenseId, reason, reporterId, reporterName } = data;
    const exp = get().expenses.find(e => e.id === expenseId);
    const trip = get().trips.find(t => t.id === tripId);
    const formattedAmount = exp ? formatCurrencyAmount(exp.amount, trip?.currency || 'INR') : '';
    const disputeText = `⚠️ ${reporterName} flagged expense "${exp?.description || 'Expense'}" (${formattedAmount}) as invalid: "${reason.trim()}"`;

    const disputePayload = JSON.stringify({
      type: 'dispute',
      text: disputeText,
      expense_id: expenseId,
      expense_data: {
        id: expenseId,
        description: exp?.description || 'Expense',
        amount: exp?.amount || 0,
        currency: trip?.currency || 'INR',
        paid_by_name: exp?.payerName || 'Member',
        paid_by_id: exp?.paid_by || '',
        split_count: exp?.splits?.length || 0,
        is_disputed: true,
        dispute_reason: reason.trim(),
        disputed_by: reporterName,
      },
    });

    await get().sendMessage(tripId, reporterId, reporterName, disputePayload);
    return true;
  },

  sendMessage: async (
    tripId: string,
    senderId: string,
    senderName: string,
    text: string,
    mediaData?: { type: 'image' | 'document'; url: string; name?: string; size?: string },
    chatTypeOverride?: 'group' | 'individual'
  ) => {
    if (!text.trim() && !mediaData) return false;

    let msgType:
      | 'text'
      | 'expense'
      | 'dispute'
      | 'system'
      | 'image'
      | 'document'
      | 'payment_claim'
      | 'payment_settlement'
      | 'payment_request' =
      mediaData ? mediaData.type : 'text';
    let displayText = text.trim();
    let expData: any = undefined;
    let expId: string | undefined = undefined;
    let rawPayloadObj: any = undefined;

    if (text.startsWith('{') && text.includes('"type":')) {
      try {
        const parsed = JSON.parse(text);
        rawPayloadObj = parsed;
        if (parsed.type) msgType = parsed.type;
        if (parsed.text) displayText = parsed.text;
        else if (parsed.type === 'payment_claim' || parsed.type === 'payment_settlement') {
          const amt = Number(parsed.amountPaise || parsed.amount_paise) || 0;
          displayText = `💸 ${parsed.paymentMode === 'cash' ? '💵 Cash' : '📱 UPI'} Payment: ${formatCurrencyAmount(amt, 'INR')}`;
        }
        if (parsed.expense_id) expId = parsed.expense_id;
        if (parsed.expense_data) expData = parsed.expense_data;
      } catch {}
    }

    const localMsgId = generateUUID();
    const createdAt = new Date().toISOString();

    const tripObj = get().trips.find(t => t.id === tripId) || get().activeTrip;
    const isFriendSplit =
      tripObj?.trip_type === 'friend_split' ||
      (tripObj as any)?.is_friend_split ||
      tripObj?.name?.toLowerCase().startsWith('split with ') ||
      Boolean(tripObj?.friend_id);
    const chatType: 'group' | 'individual' =
      chatTypeOverride || (isFriendSplit ? 'individual' : 'group');

    let effectiveSenderName = senderName?.trim() || '';
    if (!effectiveSenderName || effectiveSenderName.toLowerCase() === 'you') {
      const authState = useAuthStore.getState();
      effectiveSenderName =
        authState.profile?.full_name ||
        authState.profile?.name ||
        authState.user?.email?.split('@')[0] ||
        'Member';
    }

    let fullPayload = text.trim();
    const isPaymentType =
      msgType === 'payment_claim' ||
      msgType === 'payment_settlement' ||
      msgType === 'payment_request' ||
      (rawPayloadObj && (rawPayloadObj.type === 'payment_claim' || rawPayloadObj.type === 'payment_settlement'));

    if (mediaData && !isPaymentType) {
      fullPayload = JSON.stringify({
        type: mediaData.type,
        text: displayText || (mediaData.type === 'image' ? '📷 Photo' : '📄 Document'),
        chat_type: chatType,
        media_url: mediaData.url,
        media_name: mediaData.name,
        media_size: mediaData.size,
        is_sent: true,
        is_seen: false,
      });
    } else if (fullPayload.startsWith('{') && fullPayload.includes('"type":')) {
      try {
        const parsed = JSON.parse(fullPayload);
        parsed.chat_type = chatType;
        parsed.text = parsed.text || displayText;
        parsed.is_sent = true;
        parsed.is_seen = false;
        if (mediaData?.url && !parsed.mediaUrl && !parsed.screenshotUrl) {
          parsed.mediaUrl = mediaData.url;
        }
        rawPayloadObj = parsed;
        fullPayload = JSON.stringify(parsed);
      } catch {}
    } else {
      fullPayload = JSON.stringify({
        type: 'text',
        text: displayText,
        chat_type: chatType,
        is_sent: true,
        is_seen: false,
      });
    }

    const localMsg: TripMessage = {
      id: localMsgId,
      trip_id: tripId,
      sender_id: senderId,
      sender_name: effectiveSenderName,
      message: displayText,
      content: fullPayload,
      type: msgType,
      chat_type: chatType,
      media_url: rawPayloadObj?.mediaUrl || rawPayloadObj?.screenshotUrl || mediaData?.url,
      media_name: mediaData?.name,
      media_size: mediaData?.size,
      expense_id: expId,
      expense_data: expData,
      payload: rawPayloadObj,
      is_sent: false,
      is_seen: false,
      is_edited: false,
      created_at: createdAt,
    };

    set(state => ({ messages: [...state.messages, localMsg] }));

    try {
      const raw = await AppStorage.getItem(`@splityourtrip_local_details_${tripId}`);
      const details = raw ? JSON.parse(raw) : {};
      details.messages = [...(details.messages || []), localMsg];
      await AppStorage.setItem(`@splityourtrip_local_details_${tripId}`, JSON.stringify(details));
    } catch {}

    if (isSupabaseConfigured && isValidUUID(tripId)) {
      try {
        const authUser = useAuthStore.getState().user;
        const currentAuthUserId = authUser?.id && isValidUUID(authUser.id) ? authUser.id : null;

        // sender_id in trip_messages references auth.users(id).
        // It CAN be null, but if supplied it MUST be an existing auth user id.
        let validSenderId: string | null = null;
        if (currentAuthUserId && (senderId === currentAuthUserId || !isValidUUID(senderId) || senderId === 'local_user' || senderId === 'admin')) {
          validSenderId = currentAuthUserId;
        } else if (currentAuthUserId) {
          validSenderId = currentAuthUserId;
        }

        const client = supabaseAdmin || supabase;

        // 1. Insert into trip_messages table (service role bypasses RLS)
        const { error: msgErr } = await client.from('trip_messages').insert({
          id: localMsgId,
          trip_id: tripId,
          sender_id: validSenderId,
          sender_name: effectiveSenderName,
          message: fullPayload,
          created_at: createdAt,
        });

        if (msgErr) {
          console.warn('trip_messages insert notice, retrying with sender_id null:', msgErr.message);
          await client.from('trip_messages').insert({
            id: localMsgId,
            trip_id: tripId,
            sender_id: null,
            sender_name: effectiveSenderName,
            message: fullPayload,
            created_at: createdAt,
          });
        }

        // 2. Also insert into messages table with chat_type in metadata and valid message_type
        if (validSenderId) {
          try {
            const dbMsgType = msgType === 'expense' ? 'expense' : (msgType === 'image' ? 'image' : 'text');
            await client.from('messages').insert({
              id: localMsgId,
              trip_id: tripId,
              sender_id: validSenderId,
              content: fullPayload,
              message_type: dbMsgType,
              metadata: {
                chat_type: chatType,
                message_type: chatType === 'group' ? 'group_message' : 'individual_message',
                friend_id: tripObj?.friend_id || null,
                is_group: chatType === 'group',
              },
            });
          } catch {}
        }
      } catch (err: any) {
        console.log('sendMessage cloud insert fallback locally:', err?.message);
      }
    }

    // Update in-memory and storage to sent status (2 ticks)
    set(state => ({
      messages: state.messages.map(m => (m.id === localMsgId ? { ...m, is_sent: true } : m)),
    }));
    try {
      const raw = await AppStorage.getItem(`@splityourtrip_local_details_${tripId}`);
      if (raw) {
        const details = JSON.parse(raw);
        details.messages = (details.messages || []).map((m: any) =>
          m.id === localMsgId ? { ...m, is_sent: true } : m
        );
        await AppStorage.setItem(`@splityourtrip_local_details_${tripId}`, JSON.stringify(details));
      }
    } catch {}

    return true;
  },

  markTripMessagesAsSeen: async (tripId: string, currentUserId: string) => {
    if (!tripId) return;
    const nowIso = new Date().toISOString();

    // 1. Immediately update Zustand in-memory state
    set(state => {
      let changed = false;
      const updated = state.messages.map(m => {
        const isFromOther = m.sender_id !== currentUserId && m.sender_id !== 'local_user';
        if ((!m.trip_id || m.trip_id === tripId) && isFromOther && !m.is_seen) {
          changed = true;
          return { ...m, is_seen: true, is_sent: true, seen_at: nowIso };
        }
        return m;
      });
      return changed ? { messages: updated } : state;
    });

    // 2. Persist locally
    try {
      const raw = await AppStorage.getItem(`@splityourtrip_local_details_${tripId}`);
      if (raw) {
        const details = JSON.parse(raw);
        details.messages = (details.messages || []).map((m: any) => {
          const isFromOther = m.sender_id !== currentUserId && m.sender_id !== 'local_user';
          if (isFromOther && !m.is_seen) {
            return { ...m, is_seen: true, is_sent: true, seen_at: nowIso };
          }
          return m;
        });
        await AppStorage.setItem(`@splityourtrip_local_details_${tripId}`, JSON.stringify(details));
      }
      await AppStorage.setItem(`@splityourtrip_last_read_${tripId}`, String(Date.now()));
    } catch {}

    // 3. Clear unseen badge in contacts store immediately
    try {
      const { useContactsStore } = require('../contacts/useContactsStore');
      useContactsStore.setState((s: any) => ({
        contacts: s.contacts.map((c: any) =>
          c.defaultTripId === tripId || c.trips?.some((t: any) => t.id === tripId)
            ? { ...c, unseenMessagesCount: 0 }
            : c
        ),
      }));
    } catch {}

    // 4. Update on Supabase so seen status is persisted across fresh installs and devices
    if (isSupabaseConfigured && isValidUUID(tripId)) {
      try {
        const client = supabaseAdmin || supabase;
        const { data: rows, error } = await client
          .from('trip_messages')
          .select('id, message, sender_id')
          .eq('trip_id', tripId);

        if (!error && rows && rows.length > 0) {
          for (const row of rows) {
            if (row.sender_id && currentUserId && row.sender_id === currentUserId) continue;

            const parsed = parseMessagePayload(row.message || '');
            if (!parsed.is_seen) {
              let updatedPayload = '';
              try {
                const obj = JSON.parse(row.message || '{}');
                obj.is_seen = true;
                obj.seen_at = nowIso;
                updatedPayload = JSON.stringify(obj);
              } catch {
                updatedPayload = JSON.stringify({
                  type: 'text',
                  text: row.message || '',
                  is_seen: true,
                  seen_at: nowIso,
                });
              }

              // Update message column payload
              await client
                .from('trip_messages')
                .update({ message: updatedPayload })
                .eq('id', row.id);
            }
          }
        }
      } catch (err: any) {
        console.log('markTripMessagesAsSeen cloud sync note:', err?.message);
      }
    }
  },

  editTripMessage: async (tripId: string, messageId: string, newText: string) => {
    if (!newText.trim() || !messageId) return false;
    const cleanText = newText.trim();
    const nowIso = new Date().toISOString();

    let updatedPayload = '';
    const currentMsg = get().messages.find(m => m.id === messageId);
    if (cleanText.startsWith('{') && cleanText.includes('"type":')) {
      try {
        const parsed = JSON.parse(cleanText);
        parsed.is_edited = true;
        parsed.edited_at = nowIso;
        updatedPayload = JSON.stringify(parsed);
      } catch {
        updatedPayload = cleanText;
      }
    } else if (currentMsg?.content && currentMsg.content.startsWith('{')) {
      try {
        const obj = JSON.parse(currentMsg.content);
        obj.text = cleanText;
        obj.is_edited = true;
        obj.edited_at = nowIso;
        updatedPayload = JSON.stringify(obj);
      } catch {
        updatedPayload = JSON.stringify({
          type: 'text',
          text: cleanText,
          is_edited: true,
          edited_at: nowIso,
        });
      }
    } else {
      updatedPayload = JSON.stringify({
        type: 'text',
        text: cleanText,
        is_edited: true,
        edited_at: nowIso,
      });
    }

    const parsedNew = parseMessagePayload(updatedPayload);

    // 1. Instantly update in Zustand
    set(state => ({
      messages: state.messages.map(m =>
        m.id === messageId
          ? {
              ...m,
              message: parsedNew.displayText || cleanText,
              content: updatedPayload,
              type: parsedNew.msgType || m.type,
              payload: parsedNew.rawPayload || m.payload,
              media_url: parsedNew.mediaUrl || m.media_url,
              is_edited: true,
            }
          : m
      ),
    }));

    // 2. Persist locally
    try {
      const raw = await AppStorage.getItem(`@splityourtrip_local_details_${tripId}`);
      if (raw) {
        const details = JSON.parse(raw);
        details.messages = (details.messages || []).map((m: any) =>
          m.id === messageId
            ? {
                ...m,
                message: parsedNew.displayText || cleanText,
                content: updatedPayload,
                type: parsedNew.msgType || m.type,
                payload: parsedNew.rawPayload || m.payload,
                media_url: parsedNew.mediaUrl || m.media_url,
                is_edited: true,
              }
            : m
        );
        await AppStorage.setItem(`@splityourtrip_local_details_${tripId}`, JSON.stringify(details));
      }
    } catch {}

    // 3. Update on Supabase
    if (isSupabaseConfigured && isValidUUID(tripId)) {
      try {
        const client = supabaseAdmin || supabase;
        await client
          .from('trip_messages')
          .update({ message: updatedPayload })
          .eq('id', messageId);
        await client
          .from('messages')
          .update({ content: updatedPayload })
          .eq('id', messageId);
      } catch (err: any) {
        console.warn('editTripMessage cloud notice:', err?.message);
      }
    }
    return true;
  },

  deleteTripMessage: async (tripId: string, messageId: string) => {
    if (!messageId) return false;

    // 1. Instantly remove locally
    set(state => ({
      messages: state.messages.filter(m => m.id !== messageId),
    }));

    try {
      const raw = await AppStorage.getItem(`@splityourtrip_local_details_${tripId}`);
      if (raw) {
        const details = JSON.parse(raw);
        details.messages = (details.messages || []).filter((m: any) => m.id !== messageId);
        await AppStorage.setItem(`@splityourtrip_local_details_${tripId}`, JSON.stringify(details));
      }
    } catch {}

    // 2. Remove on Supabase
    if (isSupabaseConfigured && isValidUUID(tripId)) {
      try {
        const client = supabaseAdmin || supabase;
        await client.from('trip_messages').delete().eq('id', messageId);
        await client.from('messages').delete().eq('id', messageId);
      } catch (err: any) {
        console.warn('deleteTripMessage cloud notice:', err?.message);
      }
    }
    return true;
  },

  linkGuestWithContact: async ({ tripId, guestMemberId, guestName, contact }) => {
    const cleanGuestName = guestName.trim().toLowerCase();
    let newName = contact.name.trim();
    let newPhone = contact.phoneNumber ? contact.phoneNumber.trim() : null;
    let newProfileId = contact.profileId || undefined;

    // Database check: query profiles and trip_members to find if this phone has a registered or linked name in DB
    if (newPhone) {
      try {
        const dbContact = await get().findContactByPhone(newPhone);
        if (dbContact) {
          if (dbContact.name && dbContact.name.trim()) {
            newName = dbContact.name.trim();
          }
          if (dbContact.profileId) {
            newProfileId = dbContact.profileId;
          }
          if (dbContact.phoneNumber) {
            newPhone = dbContact.phoneNumber.trim();
          }
        }
      } catch {}
    }

    // Once linked with a contact/phone, this member is no longer an unlinked guest
    const isNowGuest = Boolean(!newProfileId && !newPhone);

    const currentTrips = [...get().trips];
    let tripsChanged = false;

    for (let i = 0; i < currentTrips.length; i++) {
      const t = currentTrips[i];
      let details: any = null;
      try {
        const raw = await AppStorage.getItem(`@splityourtrip_local_details_${t.id}`);
        if (raw) details = JSON.parse(raw);
      } catch {}

      if (!details && t.id === tripId) {
        details = {
          members: get().members.filter(m => m.trip_id === t.id),
          expenses: get().expenses.filter(e => e.trip_id === t.id),
          messages: get().messages.filter(m => m.trip_id === t.id),
        };
      }

      let tripMembers: TripMember[] = Array.isArray(details?.members) ? details.members : [];
      let memberUpdated = false;

      const isDirectFriendTrip =
        (tripId && t.id === tripId && (t.trip_type === 'friend_split' || t.name.toLowerCase().startsWith('split with '))) ||
        t.name.toLowerCase() === `split with ${cleanGuestName}`;

      const updatedMembers = tripMembers.map(m => {
        const isMatch =
          (guestMemberId && m.id === guestMemberId) ||
          (cleanGuestName && m.display_name.trim().toLowerCase() === cleanGuestName) ||
          (isDirectFriendTrip && m.role !== 'admin');

        if (isMatch && m.role !== 'admin') {
          memberUpdated = true;
          return {
            ...m,
            display_name: newName,
            phone_number: newPhone || m.phone_number || 'Linked Contact',
            profile_id: newProfileId || m.profile_id,
            user_id: newProfileId || m.user_id || null,
            is_guest: isNowGuest,
          };
        }
        return m;
      });

      if (isDirectFriendTrip) {
        currentTrips[i] = {
          ...t,
          name: `Split with ${newName}`,
          friend_id: contact.id || t.friend_id,
        };
        tripsChanged = true;
      }

      if (memberUpdated || isDirectFriendTrip) {
        const rawExps = Array.isArray(details?.expenses) ? details.expenses : [];
        const updatedExps = normalizeExpensesForTrip(
          rawExps.map((e: any) =>
            e.payerName && e.payerName.trim().toLowerCase() === cleanGuestName
              ? { ...e, payerName: newName }
              : e
          ),
          updatedMembers
        );

        try {
          await AppStorage.setItem(
            `@splityourtrip_local_details_${t.id}`,
            JSON.stringify({
              ...(details || {}),
              members: updatedMembers,
              expenses: updatedExps,
              messages: details?.messages || [],
            })
          );
        } catch {}

        if (t.id === tripId || get().activeTrip?.id === t.id) {
          const newBals = computeBalances(t.id, updatedMembers, updatedExps);
          set({
            activeTrip: currentTrips[i],
            members: updatedMembers,
            expenses: updatedExps,
            balances: newBals,
          });
        }

        if (isSupabaseConfigured && isValidUUID(t.id)) {
          (async () => {
            try {
              const memberPayload: any = {
                display_name: newName,
                phone_number: newPhone,
                is_guest: Boolean(!newProfileId),
              };
              if (newProfileId && isValidUUID(newProfileId)) {
                memberPayload.profile_id = newProfileId;
                memberPayload.user_id = newProfileId;
              }

              if (guestMemberId && isValidUUID(guestMemberId)) {
                await withTimeout(
                  supabaseAdmin.from('trip_members').update(memberPayload).eq('id', guestMemberId),
                  3500
                ).catch(() => null);
              } else {
                await withTimeout(
                  supabaseAdmin.from('trip_members').update(memberPayload).eq('trip_id', t.id).eq('display_name', cleanGuestName),
                  3500
                ).catch(() => null);
              }

              if (newProfileId && guestMemberId && isValidUUID(guestMemberId)) {
                await withTimeout(
                  supabaseAdmin.from('expense_splits').update({ profile_id: newProfileId }).eq('member_id', guestMemberId),
                  3500
                ).catch(() => null);
              }

              if (isDirectFriendTrip) {
                await withTimeout(
                  supabaseAdmin.from('trips').update({
                    name: `Split with ${newName}`,
                    friend_id: newProfileId || contact.id,
                  }).eq('id', t.id),
                  3500
                ).catch(() => null);
              }
            } catch (err: any) {
              console.warn('linkGuestWithContact Supabase sync notice:', err?.message);
            }
          })();
        }
      }
    }

    if (tripsChanged) {
      set({ trips: currentTrips });
      try {
        const userTripsKey = getUserTripsStorageKey();
        await AppStorage.setItem(userTripsKey, JSON.stringify(currentTrips));
      } catch {}
    }

    // Also ensure the contact in useContactsStore has updated name/phone & balance
    try {
      const { useContactsStore } = require('../contacts/useContactsStore');
      if (newPhone) {
        useContactsStore.getState().addManualFriend(
          newName,
          newPhone,
          newProfileId,
          Boolean(newProfileId)
        );
      }
      const currentUserId = useAuthStore.getState().user?.id;
      await useContactsStore.getState().computeFriendBalances(currentTrips, currentUserId);
    } catch {}

    return true;
  },

  claimUnlinkedSplits: async (userId: string, rawPhone?: string | null) => {
    if (!isSupabaseConfigured || !isValidUUID(userId) || !rawPhone) return;
    const digits = rawPhone.replace(/[^0-9]/g, '');
    if (digits.length < 6) return;
    const last10 = digits.slice(-10);

    // 1. First attempt via secure Postgres function
    try {
      const { data: rpcRes, error: rpcErr } = await withTimeout(
        supabase.rpc('claim_unlinked_splits', {
          target_user_id: userId,
          target_phone: last10,
        }),
        4000
      );
      if (!rpcErr && rpcRes?.success) {
        console.log('claim_unlinked_splits RPC success:', rpcRes);
        return;
      }
    } catch (e) {
      console.log('claim_unlinked_splits RPC notice:', e);
    }

    // 2. Client-side fallback: direct queries to claim matching unlinked members
    try {
      const client = supabaseAdmin || supabase;
      const { data: matchedMembers } = await withTimeout(
        client
          .from('trip_members')
          .select('id, trip_id, phone_number, profile_id')
          .ilike('phone_number', `%${last10}%`),
        4000
      );

      if (matchedMembers && matchedMembers.length > 0) {
        for (const m of matchedMembers) {
          if (m.profile_id === userId) continue;
          await client
            .from('trip_members')
            .update({
              profile_id: userId,
              user_id: userId,
              is_guest: false,
            })
            .eq('id', m.id);

          await client
            .from('expense_splits')
            .update({ profile_id: userId })
            .eq('member_id', m.id);

          await client
            .from('trips')
            .update({ friend_id: userId })
            .eq('id', m.trip_id)
            .neq('created_by', userId)
            .eq('trip_type', 'friend_split');
        }
      }
    } catch (clientClaimErr) {
      console.log('Client claim error notice:', clientClaimErr);
    }
  },

  findOrCreateFriendSplitTrip: async (friend: {
    id: string;
    name: string;
    phoneNumber?: string | null;
    profileId?: string | null;
    isGuest?: boolean;
    defaultTripId?: string;
  }): Promise<Trip | null> => {
    try {
      const authState = useAuthStore.getState();
      const currentUserId = authState.user?.id || authState.profile?.id;
      const currentUserName = authState.profile?.full_name || authState.profile?.name || 'You';
      const currentUserPhone = normalizePhone(
        authState.profile?.phone_number || (authState.user as any)?.phone || (authState.user as any)?.user_metadata?.phone_number
      );

      const rawPhone = friend.phoneNumber ? friend.phoneNumber.trim() : null;
      const cleanFriendPhone = rawPhone ? normalizePhone(rawPhone) : null;
      const cleanFriendName = friend.name.trim().toLowerCase();

      const isTrip1on1 = (t: any): boolean => {
        if (!t) return false;
        return (
          t.trip_type === 'friend_split' ||
          Boolean((t as any).is_friend_split) ||
          (typeof t.name === 'string' && t.name.toLowerCase().startsWith('split with '))
        );
      };

      // 0. If direct defaultTripId is supplied, check local store immediately (0ms instant return if 1-on-1)
      if (friend.defaultTripId) {
        const directTrip = get().trips.find(t => t.id === friend.defaultTripId);
        if (directTrip && isTrip1on1(directTrip)) {
          return directTrip;
        }
      }

      // 1. Resolve friend's profile_id if not directly provided
      let resolvedProfileId = (friend.profileId && isValidUUID(friend.profileId)) ? friend.profileId : null;
      if (!resolvedProfileId && cleanFriendPhone && isSupabaseConfigured) {
        try {
          const dbContact = await get().findContactByPhone(cleanFriendPhone);
          if (dbContact?.profileId && isValidUUID(dbContact.profileId)) {
            resolvedProfileId = dbContact.profileId;
          }
        } catch {}
      }

      // 2. Search local store trips first (STRICTLY 1-on-1 split trips only!)
      const allTrips = get().trips;
      let matchedTrip: Trip | undefined;

      // Check defaultTripId against local trips
      if (friend.defaultTripId) {
        const cand = allTrips.find(t => t.id === friend.defaultTripId);
        if (cand && isTrip1on1(cand)) {
          matchedTrip = cand;
        }
      }

      if (!matchedTrip) {
        for (const t of allTrips) {
          // CRITICAL: NEVER match a group trip as a 1-on-1 friend split!
          if (!isTrip1on1(t)) continue;

          // A. Direct friend_id match
          if (
            (resolvedProfileId && t.friend_id === resolvedProfileId) ||
            (friend.id && t.friend_id === friend.id)
          ) {
            matchedTrip = t;
            break;
          }

          // B. Match by friend_id and created_by bi-directionally
          if (resolvedProfileId && currentUserId) {
            if (
              (t.friend_id === resolvedProfileId && t.created_by === currentUserId) ||
              (t.created_by === resolvedProfileId && (t.friend_id === currentUserId || !t.friend_id))
            ) {
              matchedTrip = t;
              break;
            }
          }

          // C. Match by exact title
          const tNameLower = t.name.toLowerCase().trim();
          if (
            tNameLower === 'split with ' + cleanFriendName ||
            tNameLower === cleanFriendName
          ) {
            matchedTrip = t;
            break;
          }

          // D. Match by members inside local trip details (ONLY if trip has at most 2 members!)
          let tMembers: TripMember[] = get().members.filter(m => m.trip_id === t.id);
          if (tMembers.length === 0) {
            try {
              const raw = await AppStorage.getItem('@splityourtrip_local_details_' + t.id);
              if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed.members)) tMembers = parsed.members;
              }
            } catch {}
          }

          if (tMembers.length > 0 && tMembers.length <= 2) {
            const hasFriend = tMembers.some(m => {
              if (resolvedProfileId && (m.profile_id === resolvedProfileId || m.user_id === resolvedProfileId)) return true;
              if (cleanFriendPhone && m.phone_number && normalizePhone(m.phone_number) === cleanFriendPhone) return true;
              if (cleanFriendName && normalizeNameForMatch(m.display_name) === normalizeNameForMatch(friend.name)) return true;
              return false;
            });

            const hasMe = tMembers.some(m => {
              if (currentUserId && (m.profile_id === currentUserId || m.user_id === currentUserId)) return true;
              if (currentUserPhone && m.phone_number && normalizePhone(m.phone_number) === currentUserPhone) return true;
              if (t.created_by === currentUserId) return true;
              return false;
            });

            if (hasFriend && hasMe) {
              matchedTrip = t;
              break;
            }
          }
        }
      }

      // 3. If defaultTripId exists but wasn't in memory, check Supabase directly (must be 1-on-1!)
      if (!matchedTrip && friend.defaultTripId && isValidUUID(friend.defaultTripId) && isSupabaseConfigured) {
        try {
          const client = supabaseAdmin || supabase;
          const { data: tripRow } = await withTimeout(
            client.from('trips').select('*').eq('id', friend.defaultTripId).maybeSingle(),
            2500
          ).catch(() => ({ data: null }));
          if (tripRow && isTrip1on1(tripRow)) {
            matchedTrip = tripRow as Trip;
          }
        } catch {}
      }

      // 4. If still not found, search Supabase strictly for 1-on-1 friend split trips
      if (!matchedTrip && isSupabaseConfigured && currentUserId) {
        try {
          const client = supabaseAdmin || supabase;

          // A. Parallel bi-directional query by profile ID for 1-on-1 split trips
          if (resolvedProfileId) {
            const [q1, q2] = await Promise.all([
              withTimeout(
                client.from('trips').select('*').eq('trip_type', 'friend_split').eq('created_by', currentUserId).eq('friend_id', resolvedProfileId).limit(1),
                2500
              ).catch(() => ({ data: null })),
              withTimeout(
                client.from('trips').select('*').eq('trip_type', 'friend_split').eq('created_by', resolvedProfileId).eq('friend_id', currentUserId).limit(1),
                2500
              ).catch(() => ({ data: null })),
            ]);

            if (q1?.data && q1.data.length > 0) matchedTrip = q1.data[0] as Trip;
            else if (q2?.data && q2.data.length > 0) matchedTrip = q2.data[0] as Trip;
          }

          // B. Match 1-on-1 trips by title in Supabase
          if (!matchedTrip) {
            const { data: titleTrips } = await withTimeout(
              client.from('trips').select('*').eq('trip_type', 'friend_split').ilike('name', `split with ${cleanFriendName}%`).limit(1),
              2500
            ).catch(() => ({ data: null }));
            if (titleTrips && titleTrips.length > 0) {
              matchedTrip = titleTrips[0] as Trip;
            }
          }
        } catch (cloudErr) {
          console.log('findOrCreateFriendSplitTrip cloud lookup notice:', cloudErr);
        }
      }

      // 5. If matched trip found, cache it locally and return immediately!
      if (matchedTrip) {
        set(state => ({
          trips: [matchedTrip!, ...state.trips.filter(t => t.id !== matchedTrip!.id)],
        }));
        const userTripsKey = getUserTripsStorageKey(currentUserId);
        AppStorage.getItem(userTripsKey).then(raw => {
          const arr = raw ? JSON.parse(raw) : [];
          if (!arr.some((t: any) => t.id === matchedTrip!.id)) {
            AppStorage.setItem(userTripsKey, JSON.stringify([matchedTrip, ...arr]));
          }
        }).catch(() => {});

        // Fire-and-forget background synchronization without delaying navigation
        if (isSupabaseConfigured) {
          (async () => {
            try {
              const client = supabaseAdmin || supabase;
              if (resolvedProfileId && matchedTrip!.created_by === currentUserId && matchedTrip!.friend_id !== resolvedProfileId) {
                await client.from('trips').update({ friend_id: resolvedProfileId }).eq('id', matchedTrip!.id);
              }
              if (resolvedProfileId && cleanFriendPhone) {
                const friendLast10 = cleanFriendPhone.slice(-10);
                await client
                  .from('trip_members')
                  .update({ profile_id: resolvedProfileId, user_id: resolvedProfileId, is_guest: false })
                  .eq('trip_id', matchedTrip!.id)
                  .ilike('phone_number', '%' + friendLast10 + '%');
              }
            } catch {}
          })();
        }

        return matchedTrip;
      }

      // 6. If no trip exists anywhere, create ONE shared trip atomically with both members!
      const targetFriendId = (resolvedProfileId && isValidUUID(resolvedProfileId)) ? resolvedProfileId : undefined;
      const newTrip = await get().createTrip(
        'Split with ' + friend.name.trim(),
        currentUserId,
        currentUserName,
        'friend_split',
        targetFriendId,
        null,
        null,
        [{ name: friend.name.trim(), phoneNumber: rawPhone || undefined }]
      );

      if (newTrip) {
        if (resolvedProfileId && isSupabaseConfigured) {
          (async () => {
            try {
              const client = supabaseAdmin || supabase;
              await client.from('trips').update({ friend_id: resolvedProfileId }).eq('id', newTrip.id);
            } catch {}
          })();
        }
        return newTrip;
      }

      return null;
    } catch (err: any) {
      console.log('findOrCreateFriendSplitTrip error:', err);
      return null;
    }
  },

  syncTripMessages: async (tripId: string) => {
    if (!isSupabaseConfigured || !isValidUUID(tripId)) return;
    try {
      const client = supabaseAdmin || supabase;
      const { data, error } = await client
        .from('trip_messages')
        .select('*')
        .eq('trip_id', tripId)
        .order('created_at', { ascending: true });

      if (error || !data) return;

      const serverMsgIds = new Set(data.map(tm => tm.id));
      const currentValidExpenseIds = new Set(get().expenses.map(e => e.id));

      const tripObj = get().trips.find(t => t.id === tripId) || get().activeTrip;
      const isFriendSplit =
        tripObj?.trip_type === 'friend_split' ||
        (tripObj as any)?.is_friend_split ||
        tripObj?.name?.toLowerCase().startsWith('split with ') ||
        Boolean(tripObj?.friend_id);
      const defaultChatType: 'group' | 'individual' = isFriendSplit ? 'individual' : 'group';

      set(state => {
        // Prune messages deleted on server or referencing deleted expenses,
        // and strictly discard any messages that belong to a different trip!
        const filteredCurrent = state.messages.filter(m => {
          if (m.trip_id && m.trip_id !== tripId) {
            return false;
          }
          if (isValidUUID(m.id) && !serverMsgIds.has(m.id)) {
            return false;
          }
          const expId = m.expense_id || m.expense_data?.id;
          if (expId && (deletedExpenseIdsSet.has(expId) || !currentValidExpenseIds.has(expId))) {
            return false;
          }
          return true;
        });

        const existingIds = new Set(filteredCurrent.map(m => m.id));
        let hasChanges = filteredCurrent.length !== state.messages.length;
        const newItems: TripMessage[] = [];

        for (const tm of data) {
          if (!existingIds.has(tm.id)) {
            const parsed = parseMessagePayload(tm.message || '');
            if (parsed.expId && (deletedExpenseIdsSet.has(parsed.expId) || !currentValidExpenseIds.has(parsed.expId))) {
              continue;
            }
            hasChanges = true;
            existingIds.add(tm.id);
            newItems.push({
              id: tm.id,
              trip_id: tm.trip_id,
              sender_id: tm.sender_id,
              sender_name: tm.sender_name || 'Member',
              message: parsed.displayText,
              content: tm.message || '',
              type: parsed.msgType,
              chat_type: parsed.chatType || (tm.message?.includes('"chat_type":"user"') || tm.message?.includes('"chat_type":"individual"') ? 'individual' : defaultChatType),
              media_url: parsed.mediaUrl,
              media_name: parsed.mediaName,
              media_size: parsed.mediaSize,
              expense_id: parsed.expId,
              expense_data: parsed.expData,
              payload: parsed.rawPayload,
              created_at: tm.created_at,
            });
          }
        }

        if (!hasChanges) return state;

        const merged = [...filteredCurrent, ...newItems].sort(
          (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
        );

        AppStorage.getItem(`@splityourtrip_local_details_${tripId}`).then(raw => {
          const details = raw ? JSON.parse(raw) : {};
          details.messages = merged;
          AppStorage.setItem(`@splityourtrip_local_details_${tripId}`, JSON.stringify(details));
        }).catch(() => {});

        return { messages: merged };
      });
    } catch {}
  },

  subscribeTripRealtime: (tripId: string) => {
    if (!isSupabaseConfigured || !isValidUUID(tripId)) return () => {};

    const cleanTripId = tripId.toLowerCase();

    const handleNewMessage = (newMsg: any) => {
      if (!newMsg || !newMsg.id) return;
      if (newMsg.trip_id && newMsg.trip_id.toLowerCase() !== cleanTripId) return;

      set(state => {
        if (state.activeTrip?.id && state.activeTrip.id.toLowerCase() !== cleanTripId) return state;
        if (state.messages.some(m => m.id === newMsg.id)) return state;
        const sender = state.members.find(
          m => m.profile_id === newMsg.sender_id || m.id === newMsg.sender_id || m.user_id === newMsg.sender_id
        );
        const rawContent = newMsg.message || newMsg.content || '';
        const parsed = parseMessagePayload(rawContent);

        const tripObj = state.trips.find(t => t.id === cleanTripId) || state.activeTrip;
        const isFriendSplit =
          tripObj?.trip_type === 'friend_split' ||
          (tripObj as any)?.is_friend_split ||
          tripObj?.name?.toLowerCase().startsWith('split with ') ||
          Boolean(tripObj?.friend_id);

        const rawChatType = parsed.chatType || newMsg.metadata?.chat_type;
        const resolvedChatType: 'group' | 'individual' =
          rawChatType === 'individual' || rawChatType === 'user' || rawContent.includes('"chat_type":"user"') || rawContent.includes('"chat_type":"individual"')
            ? 'individual'
            : (isFriendSplit ? 'individual' : 'group');
        const msgObj: TripMessage = {
          id: newMsg.id,
          trip_id: newMsg.trip_id || tripId,
          sender_id: newMsg.sender_id,
          sender_name: newMsg.sender_name || sender?.display_name || 'Member',
          message: parsed.displayText,
          content: rawContent,
          type: parsed.msgType,
          chat_type: resolvedChatType,
          media_url: parsed.mediaUrl || newMsg.media_url,
          media_name: parsed.mediaName || newMsg.media_name,
          media_size: parsed.mediaSize || newMsg.media_size,
          expense_id: parsed.expId,
          expense_data: parsed.expData,
          payload: parsed.rawPayload,
          is_sent: newMsg.is_sent !== undefined ? !!newMsg.is_sent : (parsed.is_sent !== undefined ? parsed.is_sent : true),
          is_seen: newMsg.is_seen !== undefined ? !!newMsg.is_seen : (parsed.is_seen !== undefined ? parsed.is_seen : false),
          is_edited: newMsg.is_edited !== undefined ? !!newMsg.is_edited : (parsed.is_edited !== undefined ? parsed.is_edited : false),
          seen_at: newMsg.seen_at || parsed.seen_at,
          created_at: newMsg.created_at || new Date().toISOString(),
        };
        const currentThisTrip = state.messages.filter(m => !m.trip_id || m.trip_id === tripId);
        const updated = [...currentThisTrip, msgObj];
        AppStorage.getItem(`@splityourtrip_local_details_${tripId}`).then(raw => {
          const details = raw ? JSON.parse(raw) : {};
          details.messages = updated;
          AppStorage.setItem(`@splityourtrip_local_details_${tripId}`, JSON.stringify(details));
        }).catch(() => {});
        return { messages: updated };
      });
    };

    const handleUpdateMessage = (updatedMsg: any) => {
      if (!updatedMsg || !updatedMsg.id) return;
      const rawContent = updatedMsg.message || updatedMsg.content || '';
      const parsed = parseMessagePayload(rawContent);

      set(state => {
        const nextMsgs = state.messages.map(m => {
          if (m.id === updatedMsg.id) {
            return {
              ...m,
              message: parsed.displayText || m.message,
              content: rawContent,
              type: parsed.msgType || m.type,
              payload: parsed.rawPayload || m.payload,
              media_url: parsed.mediaUrl || m.media_url,
              is_sent: updatedMsg.is_sent !== undefined ? !!updatedMsg.is_sent : (parsed.is_sent !== undefined ? parsed.is_sent : m.is_sent),
              is_seen: updatedMsg.is_seen !== undefined ? !!updatedMsg.is_seen : (parsed.is_seen !== undefined ? parsed.is_seen : m.is_seen),
              is_edited: updatedMsg.is_edited !== undefined ? !!updatedMsg.is_edited : (parsed.is_edited !== undefined ? parsed.is_edited : m.is_edited),
              seen_at: updatedMsg.seen_at || parsed.seen_at || m.seen_at,
            };
          }
          return m;
        });

        AppStorage.getItem(`@splityourtrip_local_details_${tripId}`).then(raw => {
          const details = raw ? JSON.parse(raw) : {};
          details.messages = nextMsgs;
          AppStorage.setItem(`@splityourtrip_local_details_${tripId}`, JSON.stringify(details));
        }).catch(() => {});

        return { messages: nextMsgs };
      });
    };

    const channel = supabase
      .channel(`realtime:trip:${cleanTripId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'expenses', filter: `trip_id=eq.${cleanTripId}` },
        () => {
          get().loadTripDetails(tripId);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'expense_splits' },
        () => {
          get().loadTripDetails(tripId);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trip_members', filter: `trip_id=eq.${cleanTripId}` },
        () => {
          get().loadTripDetails(tripId);
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trip_messages', filter: `trip_id=eq.${cleanTripId}` },
        payload => {
          handleNewMessage(payload.new);
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'trip_messages', filter: `trip_id=eq.${cleanTripId}` },
        payload => {
          handleUpdateMessage(payload.new);
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `trip_id=eq.${cleanTripId}` },
        payload => {
          handleNewMessage(payload.new);
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'trip_messages', filter: `trip_id=eq.${cleanTripId}` },
        payload => {
          const oldMsg = payload.old as any;
          if (oldMsg?.id) {
            set(state => {
              const updated = state.messages.filter(m => m.id !== oldMsg.id);
              return { messages: updated };
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },
}));
