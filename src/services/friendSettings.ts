import { AppStorage } from '../lib/storage';
import { blockUser, unblockUser } from './blockService';

export interface FriendSettingsData {
  friendId?: string;
  tripId?: string;
  nickname?: string;
  isBlocked?: boolean;
  isMuted?: boolean;
  notes?: string;
  defaultSplit?: string;
  friendPhone?: string;
  friendName?: string;
}

export async function getFriendSettings(key: string): Promise<FriendSettingsData> {
  if (!key) return {};
  try {
    const raw = await AppStorage.getItem(`@splityourtrip_friend_settings_${key}`);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {}
  return {};
}

export async function saveFriendSettings(
  key: string,
  updates: Partial<FriendSettingsData>
): Promise<FriendSettingsData> {
  if (!key) return {};
  try {
    const existing = await getFriendSettings(key);
    const updated = { ...existing, ...updates };
    await AppStorage.setItem(`@splityourtrip_friend_settings_${key}`, JSON.stringify(updated));

    // Synchronize block state if isBlocked was toggled
    if (updates.isBlocked !== undefined) {
      try {
        const { useAuthStore } = require('../features/auth/useAuthStore');
        const auth = useAuthStore.getState();
        const currentUserId = auth.user?.id || auth.profile?.id;

        if (currentUserId) {
          const targetId = updates.friendId || existing.friendId || key;
          const tripId = updates.tripId || existing.tripId;
          const phone = updates.friendPhone || existing.friendPhone;
          const name = updates.friendName || existing.friendName || updates.nickname || existing.nickname;

          if (updates.isBlocked) {
            await blockUser({
              blockerId: currentUserId,
              blockedId: targetId && targetId !== tripId ? targetId : undefined,
              blockedPhone: phone,
              blockedName: name,
              tripId: tripId || (targetId === key && targetId.includes('-') ? targetId : undefined),
            });
          } else {
            await unblockUser({
              blockerId: currentUserId,
              blockedId: targetId && targetId !== tripId ? targetId : undefined,
              blockedPhone: phone,
              tripId: tripId || (targetId === key && targetId.includes('-') ? targetId : undefined),
            });
          }
        }
      } catch (blockErr) {
        console.warn('saveFriendSettings block sync notice:', blockErr);
      }
    }

    return updated;
  } catch {
    return updates;
  }
}
