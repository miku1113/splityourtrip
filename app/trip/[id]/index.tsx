import React, { useEffect } from 'react';
import { View, StyleSheet, StatusBar } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useTripStore, findMyMember } from '../../../src/features/trips/useTripStore';
import { useAuthStore } from '../../../src/features/auth/useAuthStore';
import { useTheme } from '../../../src/theme/useThemeStore';
import { getEffectiveContactName } from '../../../src/features/contacts/useContactsStore';
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

  const { user, profile } = useAuthStore();
  const currentUserPhone =
    profile?.phone_number || (user as any)?.phone || (user as any)?.user_metadata?.phone_number;

  const isSingleSplit =
    trip.trip_type === 'friend_split' ||
    trip.name.toLowerCase().startsWith('split with ') ||
    (members.length === 2 && !trip.image_url);

  const myMember = findMyMember(members, user?.id, currentUserPhone);
  const otherMember = members.find(m => !myMember || m.id !== myMember.id);
  const cleanTitle = isSingleSplit
    ? getEffectiveContactName({
        phoneNumber: otherMember?.phone_number,
        contactName: otherMember?.display_name,
        displayName: otherMember?.display_name,
        fallback:
          otherMember?.display_name ||
          (trip.created_by === user?.id ? trip.name.replace(/^split with\s+/i, '') : 'Friend'),
      })
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
