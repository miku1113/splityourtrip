import React from 'react';
import { View, StyleSheet, StatusBar } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import ChatView from '../../src/components/ChatView';
import { useTheme } from '../../src/theme/useThemeStore';

export default function FriendChatScreen() {
  const router = useRouter();
  const { id, friendName, friendPhone, friendId } = useLocalSearchParams<{
    id: string;
    friendName?: string;
    friendPhone?: string;
    friendId?: string;
  }>();
  const { colors, isDark } = useTheme();

  const title = friendName || 'Friend Chat';
  const subtitle = friendPhone ? `${friendPhone} • Split Your Trip` : '✨ Split Your Trip';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.card}
      />
      <ChatView
        tripId={id}
        title={title}
        subtitle={subtitle}
        avatarText={title.charAt(0).toUpperCase()}
        friendId={friendId}
        friendPhone={friendPhone}
        isGroup={false}
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
