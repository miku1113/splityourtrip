import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { AppStorage } from '../lib/storage';

// Safely obtain Notifications module only when native module is compiled in
export function getNotificationsModule(): any {
  if (Platform.OS === 'web') {
    return null;
  }
  try {
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

/**
 * Configure high-priority Android notification channels for closed-app & heads-up alerts
 */
export async function setupNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const notif = getNotificationsModule();
  if (!notif?.setNotificationChannelAsync) return;

  try {
    const importance = notif.AndroidImportance?.MAX ?? 5;
    const visibility = notif.AndroidNotificationVisibility?.PUBLIC ?? 1;

    // 1. Default system channel
    await notif.setNotificationChannelAsync('default', {
      name: 'Default',
      importance,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#6366F1',
      sound: 'default',
      enableLights: true,
      enableVibrate: true,
      showBadge: true,
      lockscreenVisibility: visibility,
    });

    // 2. Chat messages channel (high-priority heads-up notification)
    await notif.setNotificationChannelAsync('trip_chat', {
      name: 'Trip Chat & Messages',
      description: 'Notifications for incoming chat messages in trips and splits',
      importance,
      vibrationPattern: [0, 200, 150, 200],
      lightColor: '#22C55E',
      sound: 'default',
      enableLights: true,
      enableVibrate: true,
      showBadge: true,
      lockscreenVisibility: visibility,
    });

    // 3. Expenses channel (high-priority heads-up notification)
    await notif.setNotificationChannelAsync('expenses', {
      name: 'Expenses & Settlements',
      description: 'Notifications when members add expenses or settlements',
      importance,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#6366F1',
      sound: 'default',
      enableLights: true,
      enableVibrate: true,
      showBadge: true,
      lockscreenVisibility: visibility,
    });
  } catch (err) {
    console.warn('[PushNotification] Error setting up notification channels:', err);
  }
}

// Initial channel setup on module load
setupNotificationChannels().catch(() => {});

/**
 * Register device for push notifications and save push_token to Supabase profiles
 */
export async function registerForPushNotificationsAsync(userId?: string): Promise<string | null> {
  const notif = getNotificationsModule();
  if (!notif?.getPermissionsAsync) {
    return null;
  }
  try {
    // 1. Ensure notification channels are registered on Android
    await setupNotificationChannels();

    // 2. Check and request runtime notification permissions
    const { status: existingStatus } = await notif.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await notif.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
        },
      });
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.log('[PushNotification] Permission not granted. Status:', finalStatus);
      return null;
    }

    // 3. Determine EAS project ID
    let projectId: string | undefined = undefined;
    try {
      const Constants = require('expo-constants').default;
      const configuredId =
        Constants?.expoConfig?.extra?.eas?.projectId ||
        Constants?.easConfig?.projectId ||
        process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
      if (configuredId && configuredId !== 'splitYourTrip' && typeof configuredId === 'string' && configuredId.length > 10) {
        projectId = configuredId;
      }
    } catch {}

    // 4. Obtain push token
    let token: string | null = null;
    let tokenType: 'expo' | 'device' = 'expo';

    try {
      const expoToken = await notif.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined
      );
      token = expoToken?.data ?? null;
      if (token) tokenType = 'expo';
    } catch (expoErr) {
      console.log('[PushNotification] Expo push token notice:', (expoErr as any)?.message || expoErr);
      try {
        const deviceToken = await notif.getDevicePushTokenAsync();
        token = deviceToken?.data ?? null;
        if (token) tokenType = 'device';
      } catch (devErr) {
        console.log('[PushNotification] Device push token notice:', (devErr as any)?.message || devErr);
      }
    }

    if (token && userId) {
      const sb = supabase;
      await sb.from('profiles').update({ push_token: token }).eq('id', userId);
      await AppStorage.setItem(`@splityourtrip_push_token_${userId}`, token).catch(() => {});
      console.log(`[PushNotification] Registered ${tokenType} token for ${userId}:`, token.substring(0, 25) + '...');
    }

    return token;
  } catch (err) {
    console.log('[PushNotification] registerForPushNotifications error:', err);
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
    const channelId =
      data?.type === 'expense_added' || data?.type === 'payment_claim' || data?.type === 'payment_settlement'
        ? 'expenses'
        : (data?.type === 'text' || data?.type === 'image' || data?.type === 'audio' ? 'trip_chat' : 'default');

    await notif.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'default',
        data: data || {},
        channelId,
      },
      trigger: null, // Show immediately
    });
  } catch (err) {
    console.log('[PushNotification] scheduleLocalNotification notice:', err);
  }
}

/**
 * Send real push notification via Expo Push API to all other members of the trip
 * so they receive high-priority alerts even when their app is completely closed.
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
    const sb = supabase;

    // 1. Fetch only members belonging to this specific trip
    const { data: members, error: membersErr } = await sb
      .from('trip_members')
      .select('profile_id, user_id')
      .eq('trip_id', tripId);

    if (membersErr || !members || members.length === 0) return;

    const cleanSenderId = senderId?.toLowerCase()?.trim() || '';

    const recipientIds: string[] = Array.from(
      new Set(
        members
          .flatMap((m: any) => [m.profile_id, m.user_id])
          .filter((id: unknown): id is string =>
            typeof id === 'string' &&
            id.toLowerCase().trim() !== cleanSenderId &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
          )
      )
    );

    if (recipientIds.length === 0) return;

    // 2. Fetch push tokens for only those trip members
    const { data: profiles, error: profilesErr } = await sb
      .from('profiles')
      .select('id, push_token')
      .in('id', recipientIds);

    if (profilesErr || !profiles || profiles.length === 0) return;

    const validTokens = profiles
      .map((p: any) => p.push_token)
      .filter((t: string) => Boolean(t && t.length > 5));

    if (validTokens.length === 0) return;

    // Filter tokens for Expo Push API (must start with ExponentPushToken or ExpoPushToken)
    const expoTokens = validTokens.filter((t: string) =>
      t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')
    );

    const nonExpoTokens = validTokens.filter((t: string) =>
      !t.startsWith('ExponentPushToken[') && !t.startsWith('ExpoPushToken[')
    );

    if (nonExpoTokens.length > 0) {
      console.log(
        `[PushNotification] Notice: ${nonExpoTokens.length} device(s) have native FCM/APNs tokens requiring Expo project setup.`
      );
    }

    if (expoTokens.length === 0) {
      return;
    }

    // Determine target channel for Android
    const channelId =
      data?.type === 'expense_added' || data?.type === 'payment_claim' || data?.type === 'payment_settlement'
        ? 'expenses'
        : (data?.type === 'text' || data?.type === 'image' || data?.type === 'audio' ? 'trip_chat' : 'default');

    // 3. Dispatch to Expo Push API with high priority (wakes up closed apps & Doze mode)
    const messages = expoTokens.map((to: string) => ({
      to,
      sound: 'default',
      title,
      body,
      channelId,
      priority: 'high',
      _displayInForeground: true,
      data: { tripId, ...data },
    }));

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn('[PushNotification] Expo push response error:', errText);
    }
  } catch (err) {
    console.log('[PushNotification] sendPushNotificationToMembers error:', err);
  }
}
