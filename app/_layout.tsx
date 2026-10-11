import { useFonts } from 'expo-font';
import { Stack, useRouter } from 'expo-router';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useMemo } from 'react';
import 'react-native-reanimated';
import { useAuthStore } from '../src/features/auth/useAuthStore';
import { useTripStore } from '../src/features/trips/useTripStore';
import { useTheme, useThemeStore } from '../src/theme/useThemeStore';
import { useContactsStore } from '../src/features/contacts/useContactsStore';
import { subscribeToSharedData } from '../src/services/receiptOcr';
import { Platform, StatusBar, View, Text, TextInput } from 'react-native';
import * as Linking from 'expo-linking';

// Standardize responsive font behavior across devices (prevents accessibility zoom layout breakage)
if ((Text as any).defaultProps == null) {
  (Text as any).defaultProps = {};
}
(Text as any).defaultProps.allowFontScaling = false;
(Text as any).defaultProps.maxFontSizeMultiplier = 1.0;

if ((TextInput as any).defaultProps == null) {
  (TextInput as any).defaultProps = {};
}
(TextInput as any).defaultProps.allowFontScaling = false;
(TextInput as any).defaultProps.maxFontSizeMultiplier = 1.0;

export {
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: 'index',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  const { colors, isDark } = useTheme();
  const initTheme = useThemeStore(state => state.initTheme);
  const initializeAuth = useAuthStore(state => state.initialize);
  const initTrips = useTripStore(state => state.initTrips);
  const initContacts = useContactsStore(state => state.initContacts);

  const router = useRouter();

  useEffect(() => {
    initTheme();
    initializeAuth().then(() => {
      useAuthStore.getState().fetchProfile().catch(() => {});
    });
    initTrips();
    initContacts();

    // Global listener for OAuth deep links (e.g. splityourtrip://...)
    const handleDeepLink = async (event: { url: string }) => {
      const url = event?.url;
      if (
        url &&
        (url.startsWith('splityourtrip:') ||
          url.includes('access_token=') ||
          url.includes('code='))
      ) {
        console.log('[RootLayout] Deep link received:', url);
        try {
          const authRes = await useAuthStore.getState().handleAuthUrl(url);
          if (authRes?.success) {
            const loggedInUser = useAuthStore.getState().user;
            if (loggedInUser?.id) {
              await useTripStore.getState().fetchTrips(loggedInUser.id);
            }
            router.replace('/(tabs)');
          }
        } catch (err) {
          console.warn('[RootLayout] Deep link auth handler error:', err);
        }
      }
    };

    const urlSub = Linking.addEventListener('url', handleDeepLink);
    Linking.getInitialURL().then(initialUrl => {
      if (initialUrl) handleDeepLink({ url: initialUrl });
    }).catch(() => {});

    // Listen for incoming share intents (e.g. screenshot or text shared into Split Your Trip)
    const unsubscribeShared = subscribeToSharedData(shared => {
      if (shared.imageUri || shared.sharedText) {
        console.log('[RootLayout] Shared data event received:', shared);
        router.push({
          pathname: '/shared-payment',
          params: {
            imageUri: shared.imageUri || undefined,
            sharedText: shared.sharedText || undefined,
          },
        });
      }
    });

    return () => {
      urlSub.remove();
      unsubscribeShared();
    };
  }, []);

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  const navTheme = useMemo(() => {
    const base = isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      dark: isDark,
      colors: {
        ...base.colors,
        primary: colors.primary,
        background: colors.background,
        card: colors.card,
        text: colors.text,
        border: colors.border,
        notification: colors.primary,
      },
    };
  }, [isDark, colors]);

  if (!loaded) {
    return null;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ThemeProvider value={navTheme}>
        <StatusBar
          barStyle={isDark ? 'light-content' : 'dark-content'}
          backgroundColor="transparent"
          translucent={Platform.OS === 'android'}
        />
        <Stack
          screenOptions={{
            animation: 'default',
            gestureEnabled: true,
            fullScreenGestureEnabled: true,
            headerStyle: {
              backgroundColor: colors.card,
            },
            headerTitleStyle: {
              fontWeight: '700',
              color: colors.text,
            },
            headerTintColor: colors.primary,
            headerShadowVisible: false,
            contentStyle: {
              backgroundColor: colors.background,
            },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)/login" options={{ headerShown: false }} />
          <Stack.Screen name="chat/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="trip/[id]/index" options={{ headerShown: false }} />
          <Stack.Screen name="trip/[id]/info" options={{ headerShown: false }} />
          <Stack.Screen name="trip/[id]/add" options={{ title: 'Add Expense' }} />
          <Stack.Screen name="trip/[id]/expense/[expenseId]" options={{ headerShown: false }} />
          <Stack.Screen name="join/[code]" options={{ title: 'Join Trip' }} />
          <Stack.Screen name="shared-payment" options={{ title: 'Shared Payment' }} />
          <Stack.Screen name="trip/[id]/settings" options={{ headerShown: false }} />
          <Stack.Screen name="chat/[id]/settings" options={{ headerShown: false }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          <Stack.Screen name="add-expense" options={{ headerShown: false }} />
          <Stack.Screen name="add-trip" options={{ headerShown: false }} />
          <Stack.Screen name="add-contact" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        </Stack>
      </ThemeProvider>
    </View>
  );
}
