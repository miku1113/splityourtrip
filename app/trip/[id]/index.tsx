import React, { useEffect } from 'react';
import { View, StyleSheet, StatusBar } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useTripStore } from '../../../src/features/trips/useTripStore';
import { useAuthStore } from '../../../src/features/auth/useAuthStore';
import { useTheme } from '../../../src/theme/useThemeStore';
import ChatView from '../../../src/components/ChatView';

export default function TripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const {
    trips,
    members: rawMembers,
    expenses: rawExpenses,
    loadTripDetails,
    subscribeTripRealtime,
  } = useTripStore();

  const members = React.useMemo(
    () => rawMembers.filter(m => !m.trip_id || m.trip_id === id),
    [rawMembers, id]
  );
  const expenses = React.useMemo(
    () => rawExpenses.filter(e => !e.trip_id || e.trip_id === id),
    [rawExpenses, id]
  );

  const trip = trips.find(t => t.id === id) || {
    id: id || '',
    name: 'Trip Chat',
    status: 'active',
    currency: 'INR',
    created_by: '',
    created_at: new Date().toISOString(),
  };


  const { user } = useAuthStore();

  const isSingleSplit =
    trip.trip_type === 'friend_split' ||
    trip.name.toLowerCase().startsWith('split with ') ||
    (members.length === 2 && !trip.image_url);

  const myMember =
    members.find(
      m => (user?.id && (m.profile_id === user.id || m.user_id === user.id)) || m.role === 'admin'
    ) || members[0];
  const otherMember = members.find(m => m.id !== myMember?.id);
  const cleanTitle = isSingleSplit
    ? (otherMember?.display_name || trip.name.replace(/^split with\s+/i, ''))
    : trip.name;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.card}
      />

      {/* Trip Screen: Chat Interface with proper single split or group modes */}
      <ChatView
        tripId={id || ''}
        title={cleanTitle}
        subtitle={
          isSingleSplit
            ? otherMember?.phone_number
              ? `${otherMember.phone_number} • Split Your Trip`
              : '✨ Split Your Trip'
            : `${members.length} members • ${expenses.length} expenses`
        }
        avatarText={isSingleSplit ? cleanTitle.charAt(0).toUpperCase() : undefined}
        friendId={isSingleSplit ? (otherMember?.id || trip.friend_id) : undefined}
        friendPhone={isSingleSplit ? (otherMember?.phone_number || undefined) : undefined}
        isGroup={!isSingleSplit}
        showHeader={true}
        onBack={() => router.back()}
        onAddExpense={() => {
          router.push({
            pathname: '/trip/[id]/add',
            params: { id },
          });
        }}
        onSettleUp={() => {
          router.push({
            pathname: '/trip/[id]/info',
            params: { id, tab: 'settle' },
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
