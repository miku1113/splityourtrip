import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Linking } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/useThemeStore';
import { useAuthStore } from '../../src/features/auth/useAuthStore';
import { useTripStore } from '../../src/features/trips/useTripStore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AddExpenseChoiceModal from '../../src/components/AddExpenseChoiceModal';
import SidebarDrawer from '../../src/components/SidebarDrawer';
import NotificationToast from '../../src/components/NotificationToast';
import NotificationCenterModal from '../../src/components/NotificationCenterModal';
import SettleUpModal from '../../src/components/SettleUpModal';
import { useNotificationStore } from '../../src/features/notifications/useNotificationStore';
import { syncWidgetSummary } from '../../src/services/widgetService';

export default function TabLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { user, profile } = useAuthStore();
  const { trips } = useTripStore();
  const [expenseModalVisible, setExpenseModalVisible] = useState(false);
  const [settleUpModalVisible, setSettleUpModalVisible] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifModalVisible, setNotifModalVisible] = useState(false);
  const unreadNotifCount = useNotificationStore(s => s.unreadCount);
  const loadNotifications = useNotificationStore(s => s.loadNotifications);

  useEffect(() => {
    loadNotifications(user?.id);
  }, [user?.id]);

  // Sync widget summary whenever trips change
  useEffect(() => {
    syncWidgetSummary({
      tripCount: trips.length,
    });
  }, [trips.length]);

  // Listen to incoming widget shortcut links while tabs are active
  useEffect(() => {
    let lastProcessedUrl: string | null = null;
    const handleUrl = (url: string | null) => {
      if (!url || url === lastProcessedUrl) return;
      lastProcessedUrl = url;
      const lower = url.toLowerCase();
      if (lower.includes('add-expense') || lower.includes('add-trip') || lower.includes('add-contact')) {
        if (lower.includes('new-trip') || lower.includes('add-trip')) {
          router.push('/add-expense?action=new-trip' as any);
        } else if (lower.includes('new-contact') || lower.includes('add-contact')) {
          router.push('/add-expense?action=new-contact' as any);
        } else {
          router.push('/add-expense' as any);
        }
      } else if (lower.includes('shared-payment')) {
        router.push('/shared-payment');
      } else if (lower.includes('friends')) {
        router.push('/(tabs)/friends');
      } else if (lower.includes('trips')) {
        router.push('/(tabs)');
      }
    };

    const sub = Linking.addEventListener('url', event => handleUrl(event.url));
    return () => sub.remove();
  }, []);

  const openSidebar = () => setSidebarOpen(true);
  const closeSidebar = () => setSidebarOpen(false);

  return (
    <>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            height: 60 + Math.max(insets.bottom, 0),
            paddingBottom: Math.max(insets.bottom, 8),
            paddingTop: 8,
          },
          headerStyle: {
            backgroundColor: colors.card,
          },
          headerTitleStyle: {
            fontWeight: '700',
            color: colors.text,
          },
          headerShadowVisible: false,
          headerLeft: () => (
            <View style={styles.headerLeft}>
              <Image
                source={require('../../assets/images/icon.png')}
                style={styles.appIcon}
                resizeMode="contain"
              />
            </View>
          ),
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TouchableOpacity
                style={styles.notifBtn}
                onPress={() => setNotifModalVisible(true)}
                activeOpacity={0.7}
              >
                <Ionicons name="notifications-outline" size={23} color={colors.text} />
                {unreadNotifCount > 0 && (
                  <View style={[styles.notifBadge, { backgroundColor: colors.danger }]}>
                    <Text style={styles.notifBadgeText}>
                      {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.hamburgerBtn}
                onPress={openSidebar}
                activeOpacity={0.7}
              >
                <Ionicons name="menu-outline" size={26} color={colors.text} />
              </TouchableOpacity>
            </View>
          ),
        }}
      >
        {/* Tab 1: Friends (First) */}
        <Tabs.Screen
          name="friends"
          options={{
            title: 'Friends',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={focused ? 'people' : 'people-outline'}
                size={size}
                color={color}
              />
            ),
          }}
        />

        {/* Tab 2: Trips (Second) */}
        <Tabs.Screen
          name="index"
          options={{
            title: 'Trips',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={focused ? 'airplane' : 'airplane-outline'}
                size={size}
                color={color}
              />
            ),
          }}
        />

        {/* Tab 3: Center Elevated Add Expense Action Button */}
        <Tabs.Screen
          name="center-action"
          listeners={{
            tabPress: (e) => {
              e.preventDefault();
              setExpenseModalVisible(true);
            },
          }}
          options={{
            title: '',
            tabBarLabel: () => null,
            tabBarButton: () => (
              <View style={styles.centerButtonWrapper}>
                <TouchableOpacity
                  style={styles.centerFab}
                  onPress={() => setExpenseModalVisible(true)}
                  activeOpacity={0.85}
                >
                  <View
                    style={[
                      styles.centerFabInner,
                      {
                        backgroundColor: colors.primary,
                        shadowColor: colors.primary,
                      },
                    ]}
                  >
                    <Ionicons name="add" size={30} color="#FFFFFF" />
                  </View>
                </TouchableOpacity>
              </View>
            ),
          }}
        />

        {/* Tab 4: Analyser (Third) */}
        <Tabs.Screen
          name="analyser"
          options={{
            title: 'Analyser',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={focused ? 'pie-chart' : 'pie-chart-outline'}
                size={size}
                color={color}
              />
            ),
          }}
        />

        {/* Tab 5: Profile (Fourth) */}
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color, size, focused }) => {
              if (profile?.avatar_url) {
                return (
                  <View
                    style={{
                      width: size + 2,
                      height: size + 2,
                      borderRadius: (size + 2) / 2,
                      borderWidth: focused ? 2 : 1,
                      borderColor: color,
                      overflow: 'hidden',
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}
                  >
                    <Image
                      source={{ uri: profile.avatar_url }}
                      style={{ width: '100%', height: '100%' }}
                      resizeMode="cover"
                    />
                  </View>
                );
              }
              return (
                <Ionicons
                  name={focused ? 'person-circle' : 'person-circle-outline'}
                  size={size}
                  color={color}
                />
              );
            },
          }}
        />
      </Tabs>

      {/* Sidebar Drawer (slides from right, animated X inside modal overlay) */}
      <SidebarDrawer
        visible={sidebarOpen}
        onClose={closeSidebar}
      />

      {/* Center Action Modal: Pick between Trip or Friend split */}
      <AddExpenseChoiceModal
        visible={expenseModalVisible}
        onClose={() => setExpenseModalVisible(false)}
        onOpenSettleUp={() => {
          setExpenseModalVisible(false);
          setTimeout(() => setSettleUpModalVisible(true), 200);
        }}
      />

      {/* Settle Up / Pay Modal (Cash & UPI) */}
      <SettleUpModal
        visible={settleUpModalVisible}
        onClose={() => setSettleUpModalVisible(false)}
      />

      {/* In-App Notification Toast Banner */}
      <NotificationToast />

      {/* Notification Center Modal */}
      <NotificationCenterModal
        visible={notifModalVisible}
        onClose={() => setNotifModalVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  headerLeft: {
    marginLeft: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  appIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
  },
  notifBtn: {
    padding: 6,
    marginRight: 6,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  notifBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  notifBadgeText: {
    color: '#FFFFFF',
    fontSize: 9.5,
    fontWeight: '800',
  },
  hamburgerBtn: {
    marginRight: 16,
    padding: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerButtonWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerFab: {
    top: -14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerFabInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 8,
  },
});
