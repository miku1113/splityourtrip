import { Platform } from 'react-native';
import { supabase, supabaseAdmin } from '../lib/supabase';

// Safely check whether the ExpoPushTokenManager native module is compiled into this binary
function isNotificationsNativeAvailable(): boolean {
  try {
    if (typeof globalThis !== 'undefined') {
      const expo = (globalThis as any).expo;
      if (expo?.modules?.ExpoPushTokenManager) {
        return true;
      }
    }
    const { NativeModules } = require('react-native');
    if (NativeModules?.NativeUnimoduleProxy?.exportedMethods?.ExpoPushTokenManager) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Safely obtain Notifications module only when native module is compiled in
function getNotificationsModule(): any {
  try {
    if (!isNotificationsNativeAvailable()) {
      return null;
    }
    return require('expo-notifications');
  } catch (err) {
    return null;
  }
}

const Notifications = getNotificationsModule();

// Configure foreground & background notification presentation if available
try {
  Notifications?.setNotificationHandler?.({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
} catch {}

// Configure default Android notification channel with high priority
if (Platform.OS === 'android' && Notifications?.setNotificationChannelAsync) {
  Notifications.setNotificationChannelAsync('default', {
    name: 'Default',
    importance: Notifications.AndroidImportance?.MAX ?? 5,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#6366F1',
    sound: 'default',
  }).catch(() => {});
}

/**
 * Register device for push notifications and save push_token to Supabase profiles
 */
export async function registerForPushNotificationsAsync(userId?: string): Promise<string | null> {
  const notif = getNotificationsModule();
  if (!notif?.getPermissionsAsync) {
    return null;
  }
  try {
    const { status: existingStatus } = await notif.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await notif.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      return null;
    }

    let token: string | null = null;
    try {
      const expoToken = await notif.getExpoPushTokenAsync();
      token = expoToken?.data ?? null;
    } catch {
      try {
        const deviceToken = await notif.getDevicePushTokenAsync();
        token = deviceToken?.data ?? null;
      } catch {}
    }

    if (token && userId) {
      const sb = supabaseAdmin || supabase;
      await sb.from('profiles').update({ push_token: token }).eq('id', userId);
    }

    return token;
  } catch (err) {
    console.log('registerForPushNotifications notice:', err);
    return null;
  }
}

/**
 * Trigger an instant native OS notification (displays in system notification drawer)
 */
export async function scheduleLocalNotification(title: string, body: string, data?: any): Promise<void> {
  const notif = getNotificationsModule();
  if (!notif?.scheduleNotificationAsync) {
    return;
  }
  try {
    await notif.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'default',
        data: data || {},
      },
      trigger: null, // Show immediately
    });
  } catch (err) {
    console.log('scheduleLocalNotification notice:', err);
  }
}

/**
 * Send real push notification via Expo Push API to all other members of the trip
 * so they receive the notification even when their app is completely closed.
 */
export async function sendPushNotificationToMembers(
  tripId: string,
  senderId: string,
  title: string,
  body: string,
  data?: any
): Promise<void> {
  try {
    if (!tripId) return;
    const sb = supabaseAdmin || supabase;

    // 1. Fetch only members belonging to this specific trip
    const { data: members } = await sb
      .from('trip_members')
      .select('profile_id, user_id')
      .eq('trip_id', tripId);

    if (!members || members.length === 0) return;

    const recipientIds: string[] = Array.from(
      new Set(
        members
          .map((m: any) => m.profile_id || m.user_id)
          .filter((id: string) => id && id !== senderId)
      )
    );

    if (recipientIds.length === 0) return;

    // 2. Fetch push tokens for only those trip members
    const { data: profiles } = await sb
      .from('profiles')
      .select('push_token')
      .in('id', recipientIds);

    if (!profiles || profiles.length === 0) return;

    const validTokens = profiles
      .map((p: any) => p.push_token)
      .filter((t: string) => Boolean(t && t.length > 5));

    if (validTokens.length === 0) return;

    // 3. Dispatch to Expo Push API
    const messages = validTokens.map((to: string) => ({
      to,
      sound: 'default',
      title,
      body,
      channelId: 'default',
      data: { tripId, ...data },
    }));

    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });
  } catch (err) {
    console.log('sendPushNotificationToMembers error:', err);
  }
}
