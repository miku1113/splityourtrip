import { supabase } from '../lib/supabase';
import { AppStorage } from '../lib/storage';
import { normalizePhone } from '../features/contacts/useContactsStore';
import { Trip } from '../types/database';

export interface BlockedUserRecord {
  id: string;
  blockerId: string;
  blockedId?: string | null;
  blockedPhone?: string | null;
  blockedName?: string | null;
  tripId?: string | null;
  blockedAt: string;
}

export interface TripBlockMeta {
  is_blocked: boolean;
  blocked_by?: string;
  blocked_id?: string | null;
  blocked_phone?: string | null;
  blocked_name?: string | null;
  blocked_at?: string;
}

const MEMORY_CACHE_TTL_MS = 3000;
let cachedBilateralBlocks: {
  userId: string;
  timestamp: number;
  blockedUserIds: Set<string>;
  blockedPhones: Set<string>;
  blockedTripIds: Set<string>;
} | null = null;

export function invalidateBlockCache() {
  cachedBilateralBlocks = null;
}

/**
 * Parses trip description to see if the trip is marked as blocked.
 */
export function parseTripBlockMeta(description?: string | null): TripBlockMeta | null {
  if (!description || typeof description !== 'string') return null;
  const trimmed = description.trim();
  if (!trimmed.startsWith('{') || !trimmed.includes('"is_blocked"')) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && parsed.is_blocked === true) {
      return parsed as TripBlockMeta;
    }
  } catch {}
  return null;
}

/**
 * Checks whether a trip is blocked either by current user or the other user.
 */
export function isTripBlockedBilateral(
  trip: Trip | null | undefined,
  currentUserId?: string | null,
  currentUserPhone?: string | null
): { isBlocked: boolean; isBlockedByMe: boolean; blockedBy?: string } {
  if (!trip) return { isBlocked: false, isBlockedByMe: false };
  const blockMeta = parseTripBlockMeta(trip.description);
  if (!blockMeta || !blockMeta.is_blocked) {
    return { isBlocked: false, isBlockedByMe: false };
  }

  const blockerId = blockMeta.blocked_by;
  const isBlockedByMe = Boolean(currentUserId && blockerId === currentUserId);
  return {
    isBlocked: true,
    isBlockedByMe,
    blockedBy: blockerId,
  };
}

/**
 * Fetches bilateral blocked IDs and phone numbers for a user.
 * If User A blocked User B, User B is blocked for User A AND User A is blocked for User B.
 */
export async function getBilateralBlockedSet(
  userId: string,
  userPhone?: string | null
): Promise<{
  blockedUserIds: Set<string>;
  blockedPhones: Set<string>;
  blockedTripIds: Set<string>;
}> {
  if (!userId) {
    return {
      blockedUserIds: new Set<string>(),
      blockedPhones: new Set<string>(),
      blockedTripIds: new Set<string>(),
    };
  }

  if (
    cachedBilateralBlocks &&
    cachedBilateralBlocks.userId === userId &&
    Date.now() - cachedBilateralBlocks.timestamp < MEMORY_CACHE_TTL_MS
  ) {
    return cachedBilateralBlocks;
  }

  const blockedUserIds = new Set<string>();
  const blockedPhones = new Set<string>();
  const blockedTripIds = new Set<string>();

  const cleanUserPhone = userPhone ? normalizePhone(userPhone) : '';
  const last10 = cleanUserPhone && cleanUserPhone.length >= 6 ? cleanUserPhone.slice(-10) : '';

  // 1. Read local storage cache of blocks
  try {
    const rawLocal = await AppStorage.getItem(`@splityourtrip_blocked_users_${userId}`);
    if (rawLocal) {
      const records: BlockedUserRecord[] = JSON.parse(rawLocal);
      for (const rec of records) {
        if (rec.blockedId) blockedUserIds.add(rec.blockedId);
        if (rec.blockedPhone) {
          const norm = normalizePhone(rec.blockedPhone);
          if (norm) {
            blockedPhones.add(norm);
            if (norm.length >= 6) blockedPhones.add(norm.slice(-10));
          }
        }
        if (rec.tripId) blockedTripIds.add(rec.tripId);
      }
    }
  } catch {}

  const sb = supabase;

  // 2. Query public.user_blocks table if available
  try {
    const { data: userBlocks } = await sb
      .from('user_blocks')
      .select('*')
      .or(
        last10
          ? `blocker_id.eq.${userId},blocked_id.eq.${userId},blocked_phone.ilike.%${last10}%`
          : `blocker_id.eq.${userId},blocked_id.eq.${userId}`
      );

    if (userBlocks && Array.isArray(userBlocks)) {
      for (const b of userBlocks) {
        const isBlockerMe = b.blocker_id === userId;
        const otherId = isBlockerMe ? b.blocked_id : b.blocker_id;
        if (otherId) blockedUserIds.add(otherId);

        if (b.blocked_phone) {
          const norm = normalizePhone(b.blocked_phone);
          if (norm) {
            blockedPhones.add(norm);
            if (norm.length >= 6) blockedPhones.add(norm.slice(-10));
          }
        }
        if (b.trip_id) blockedTripIds.add(b.trip_id);
      }
    }
  } catch {}

  // 3. Query trips table for friend_split trips with blocked JSON description
  try {
    const { data: trips } = await sb
      .from('trips')
      .select('id, name, trip_type, friend_id, created_by, description')
      .or(`created_by.eq.${userId},friend_id.eq.${userId}`)
      .ilike('description', '%"is_blocked":true%');

    if (trips && Array.isArray(trips)) {
      for (const t of trips) {
        const meta = parseTripBlockMeta(t.description);
        if (meta && meta.is_blocked) {
          blockedTripIds.add(t.id);
          const isCreatorMe = t.created_by === userId;
          const otherId = isCreatorMe ? t.friend_id : t.created_by;
          if (otherId) blockedUserIds.add(otherId);
          if (meta.blocked_id) blockedUserIds.add(meta.blocked_id);
          if (meta.blocked_by) blockedUserIds.add(meta.blocked_by);
          if (meta.blocked_phone) {
            const norm = normalizePhone(meta.blocked_phone);
            if (norm) {
              blockedPhones.add(norm);
              if (norm.length >= 6) blockedPhones.add(norm.slice(-10));
            }
          }
        }
      }
    }
  } catch {}

  const result = {
    userId,
    timestamp: Date.now(),
    blockedUserIds,
    blockedPhones,
    blockedTripIds,
  };

  cachedBilateralBlocks = result;
  return result;
}

/**
 * Blocks a contact / friend across local storage, trips table, and user_blocks table.
 */
export async function blockUser(params: {
  blockerId: string;
  blockedId?: string | null;
  blockedPhone?: string | null;
  blockedName?: string | null;
  tripId?: string | null;
}): Promise<void> {
  const { blockerId, blockedId, blockedPhone, blockedName, tripId } = params;
  if (!blockerId) return;

  invalidateBlockCache();

  const cleanPhone = blockedPhone ? normalizePhone(blockedPhone) : null;
  const nowIso = new Date().toISOString();

  // 1. Update local storage list of blocked users
  try {
    const rawLocal = await AppStorage.getItem(`@splityourtrip_blocked_users_${blockerId}`);
    const list: BlockedUserRecord[] = rawLocal ? JSON.parse(rawLocal) : [];
    const exists = list.some(
      r =>
        (blockedId && r.blockedId === blockedId) ||
        (cleanPhone && r.blockedPhone && normalizePhone(r.blockedPhone) === cleanPhone) ||
        (tripId && r.tripId === tripId)
    );
    if (!exists) {
      list.push({
        id: `block_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        blockerId,
        blockedId: blockedId || null,
        blockedPhone: cleanPhone,
        blockedName: blockedName || null,
        tripId: tripId || null,
        blockedAt: nowIso,
      });
      await AppStorage.setItem(
        `@splityourtrip_blocked_users_${blockerId}`,
        JSON.stringify(list)
      );
    }
  } catch {}

  // 2. Also set local friend settings
  const settingsKey = blockedId || tripId || cleanPhone;
  if (settingsKey) {
    try {
      const raw = await AppStorage.getItem(`@splityourtrip_friend_settings_${settingsKey}`);
      const parsed = raw ? JSON.parse(raw) : {};
      parsed.isBlocked = true;
      await AppStorage.setItem(
        `@splityourtrip_friend_settings_${settingsKey}`,
        JSON.stringify(parsed)
      );
    } catch {}
  }

  const sb = supabase;

  // 3. Update trips table in Supabase so the block is immediately visible to Player B
  if (tripId) {
    try {
      const blockPayload: TripBlockMeta = {
        is_blocked: true,
        blocked_by: blockerId,
        blocked_id: blockedId || null,
        blocked_phone: cleanPhone,
        blocked_name: blockedName || null,
        blocked_at: nowIso,
      };
      await sb
        .from('trips')
        .update({ description: JSON.stringify(blockPayload) })
        .eq('id', tripId);
    } catch (err) {
      console.warn('Trips block description update notice:', err);
    }
  }

  // 4. Also insert into public.user_blocks table if it exists
  try {
    await sb.from('user_blocks').upsert({
      blocker_id: blockerId,
      blocked_id: blockedId || null,
      blocked_phone: cleanPhone,
      blocked_name: blockedName || null,
      trip_id: tripId || null,
      created_at: nowIso,
    });
  } catch {}

  // 5. Invalidate caches and trigger store refreshes
  invalidateBlockCache();
  try {
    const { invalidateFriendsSummaryCache } = require('./friendsApi');
    invalidateFriendsSummaryCache(blockerId);
  } catch {}
}

/**
 * Unblocks a contact / friend across local storage, trips table, and user_blocks table.
 */
export async function unblockUser(params: {
  blockerId: string;
  blockedId?: string | null;
  blockedPhone?: string | null;
  tripId?: string | null;
}): Promise<void> {
  const { blockerId, blockedId, blockedPhone, tripId } = params;
  if (!blockerId) return;

  invalidateBlockCache();
  const cleanPhone = blockedPhone ? normalizePhone(blockedPhone) : null;

  // 1. Update local storage list
  try {
    const rawLocal = await AppStorage.getItem(`@splityourtrip_blocked_users_${blockerId}`);
    if (rawLocal) {
      let list: BlockedUserRecord[] = JSON.parse(rawLocal);
      list = list.filter(r => {
        if (tripId && r.tripId === tripId) return false;
        if (blockedId && r.blockedId === blockedId) return false;
        if (cleanPhone && r.blockedPhone && normalizePhone(r.blockedPhone) === cleanPhone) return false;
        return true;
      });
      await AppStorage.setItem(
        `@splityourtrip_blocked_users_${blockerId}`,
        JSON.stringify(list)
      );
    }
  } catch {}

  // 2. Clear local friend settings
  const settingsKey = blockedId || tripId || cleanPhone;
  if (settingsKey) {
    try {
      const raw = await AppStorage.getItem(`@splityourtrip_friend_settings_${settingsKey}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        parsed.isBlocked = false;
        await AppStorage.setItem(
          `@splityourtrip_friend_settings_${settingsKey}`,
          JSON.stringify(parsed)
        );
      }
    } catch {}
  }

  const sb = supabase;

  // 3. Clear description in trips table
  if (tripId) {
    try {
      await sb
        .from('trips')
        .update({ description: '' })
        .eq('id', tripId);
    } catch (err) {
      console.warn('Trips unblock description update notice:', err);
    }
  }

  // 4. Delete from public.user_blocks table if exists
  try {
    let query = sb.from('user_blocks').delete().eq('blocker_id', blockerId);
    if (tripId) {
      query = query.eq('trip_id', tripId);
    } else if (blockedId) {
      query = query.eq('blocked_id', blockedId);
    } else if (cleanPhone) {
      query = query.eq('blocked_phone', cleanPhone);
    }
    await query;
  } catch {}

  // 5. Invalidate caches and trigger store refreshes
  invalidateBlockCache();
  try {
    const { invalidateFriendsSummaryCache } = require('./friendsApi');
    invalidateFriendsSummaryCache(blockerId);
  } catch {}
}

/**
 * Returns all users blocked BY current user (for Blocked Users UI list in Settings).
 */
export async function getBlockedUsersList(userId: string): Promise<BlockedUserRecord[]> {
  if (!userId) return [];

  const map = new Map<string, BlockedUserRecord>();

  // 1. Read local storage
  try {
    const rawLocal = await AppStorage.getItem(`@splityourtrip_blocked_users_${userId}`);
    if (rawLocal) {
      const list: BlockedUserRecord[] = JSON.parse(rawLocal);
      for (const item of list) {
        const key = item.blockedId || item.tripId || item.blockedPhone || item.id;
        map.set(key, item);
      }
    }
  } catch {}

  const sb = supabase;

  // 2. Read from user_blocks if table exists
  try {
    const { data: userBlocks } = await sb
      .from('user_blocks')
      .select('*')
      .eq('blocker_id', userId);

    if (userBlocks && Array.isArray(userBlocks)) {
      for (const b of userBlocks) {
        const key = b.blocked_id || b.trip_id || b.blocked_phone || b.id;
        map.set(key, {
          id: b.id,
          blockerId: b.blocker_id,
          blockedId: b.blocked_id,
          blockedPhone: b.blocked_phone,
          blockedName: b.blocked_name,
          tripId: b.trip_id,
          blockedAt: b.created_at || new Date().toISOString(),
        });
      }
    }
  } catch {}

  // 3. Read from trips where created_by is current user and description is blocked
  try {
    const { data: trips } = await sb
      .from('trips')
      .select('id, name, trip_type, friend_id, created_by, description, updated_at')
      .or(`created_by.eq.${userId},friend_id.eq.${userId}`)
      .ilike('description', '%"is_blocked":true%');

    if (trips && Array.isArray(trips)) {
      for (const t of trips) {
        const meta = parseTripBlockMeta(t.description);
        if (meta && meta.is_blocked && meta.blocked_by === userId) {
          const otherId = t.created_by === userId ? t.friend_id : t.created_by;
          const key = otherId || t.id;
          if (!map.has(key)) {
            map.set(key, {
              id: `trip_block_${t.id}`,
              blockerId: userId,
              blockedId: otherId,
              blockedPhone: meta.blocked_phone || null,
              blockedName: meta.blocked_name || t.name.replace(/^split with /i, '').trim(),
              tripId: t.id,
              blockedAt: meta.blocked_at || t.updated_at || new Date().toISOString(),
            });
          }
        }
      }
    }
  } catch {}

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.blockedAt).getTime() - new Date(a.blockedAt).getTime()
  );
}
