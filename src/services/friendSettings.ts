import { AppStorage } from '../lib/storage';

export interface FriendSettingsData {
  friendId?: string;
  tripId?: string;
  nickname?: string;
  isBlocked?: boolean;
  isMuted?: boolean;
  notes?: string;
  defaultSplit?: string;
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

export async function saveFriendSettings(key: string, updates: Partial<FriendSettingsData>): Promise<FriendSettingsData> {
  if (!key) return {};
  try {
    const existing = await getFriendSettings(key);
    const updated = { ...existing, ...updates };
    await AppStorage.setItem(`@splityourtrip_friend_settings_${key}`, JSON.stringify(updated));
    return updated;
  } catch {
    return updates;
  }
}
