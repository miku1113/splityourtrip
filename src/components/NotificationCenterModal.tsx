import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  StatusBar,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNotificationStore, AppNotification } from '../features/notifications/useNotificationStore';
import { useTheme } from '../theme/useThemeStore';

interface NotificationCenterModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function NotificationCenterModal({
  visible,
  onClose,
}: NotificationCenterModalProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const notifications = useNotificationStore((s) => s.notifications);
  const markAsRead = useNotificationStore((s) => s.markAsRead);
  const markAllAsRead = useNotificationStore((s) => s.markAllAsRead);
  const clearAllNotifications = useNotificationStore((s) => s.clearAllNotifications);

  const handleNotificationPress = (item: AppNotification) => {
    markAsRead(item.id);
    onClose();

    if (item.tripId) {
      router.push(`/trip/${item.tripId}` as any);
    } else if (item.friendId) {
      router.push('/(tabs)/friends' as any);
    }
  };

  const formatTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  const getIconConfig = (type: AppNotification['type']) => {
    switch (type) {
      case 'payment_claim':
      case 'payment_request':
        return { name: 'card' as const, color: '#10B981', bg: isDark ? 'rgba(16, 185, 129, 0.2)' : '#D1FAE5' };
      case 'payment_accepted':
        return { name: 'checkmark-circle' as const, color: '#10B981', bg: isDark ? 'rgba(16, 185, 129, 0.2)' : '#D1FAE5' };
      case 'payment_rejected':
        return { name: 'close-circle' as const, color: '#EF4444', bg: isDark ? 'rgba(239, 68, 68, 0.2)' : '#FEE2E2' };
      case 'expense':
        return { name: 'receipt' as const, color: '#F59E0B', bg: isDark ? 'rgba(245, 158, 11, 0.2)' : '#FEF3C7' };
      case 'trip_member_added':
      case 'trip_member_removed':
        return { name: 'people' as const, color: '#8B5CF6', bg: isDark ? 'rgba(139, 92, 246, 0.2)' : '#EDE9FE' };
      case 'message':
      default:
        return { name: 'chatbubble-ellipses' as const, color: '#6366F1', bg: isDark ? 'rgba(99, 102, 241, 0.2)' : '#EEF2FF' };
    }
  };

  const renderItem = ({ item }: { item: AppNotification }) => {
    const iconInfo = getIconConfig(item.type);
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => handleNotificationPress(item)}
        style={[
          styles.itemRow,
          {
            backgroundColor: item.read
              ? 'transparent'
              : isDark
              ? 'rgba(99, 102, 241, 0.08)'
              : '#F8FAFC',
            borderBottomColor: colors.border,
          },
        ]}
      >
        <View style={[styles.iconWrapper, { backgroundColor: iconInfo.bg }]}>
          <Ionicons name={iconInfo.name} size={18} color={iconInfo.color} />
        </View>

        <View style={styles.itemContent}>
          <View style={styles.itemHeaderRow}>
            <Text
              style={[
                styles.itemTitle,
                { color: colors.text, fontWeight: item.read ? '600' : '700' },
              ]}
              numberOfLines={1}
            >
              {item.title}
            </Text>
            <Text style={[styles.itemTime, { color: colors.textMuted }]}>
              {formatTime(item.timestamp)}
            </Text>
          </View>

          <Text
            style={[
              styles.itemMessage,
              { color: item.read ? colors.textSecondary : colors.text },
            ]}
            numberOfLines={2}
          >
            {item.message}
          </Text>
        </View>

        {!item.read && (
          <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />
        )}
      </TouchableOpacity>
    );
  };

  const topPadding = Math.max(
    insets.top,
    Platform.OS === 'android' ? (StatusBar.currentHeight || 28) : 0
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.container,
          { backgroundColor: colors.background, paddingTop: topPadding },
        ]}
      >
          <StatusBar
            barStyle={isDark ? 'light-content' : 'dark-content'}
            backgroundColor={colors.background}
          />
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <TouchableOpacity
              onPress={onClose}
              style={styles.backBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>

            <Text style={[styles.headerTitle, { color: colors.text }]}>
              Notifications
            </Text>

            <View style={styles.headerActions}>
              {notifications.length > 0 && (
                <TouchableOpacity
                  onPress={markAllAsRead}
                  style={styles.markReadBtn}
                >
                  <Text style={[styles.markReadText, { color: colors.primary }]}>
                    Read All
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* List of Notifications */}
          {notifications.length === 0 ? (
            <View style={styles.emptyContainer}>
              <View
                style={[
                  styles.emptyIconBg,
                  { backgroundColor: isDark ? '#1E293B' : '#F1F5F9' },
                ]}
              >
                <Ionicons
                  name="notifications-off-outline"
                  size={40}
                  color={colors.textMuted}
                />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                No notifications yet
              </Text>
              <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
                We’ll notify you when you get messages, new expenses, trip changes, or payment requests.
              </Text>
            </View>
          ) : (
            <FlatList
              data={notifications}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              contentContainerStyle={styles.listContent}
            />
          )}

          {notifications.length > 0 && (
            <View style={[styles.footer, { borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
              <TouchableOpacity
                onPress={clearAllNotifications}
                style={styles.clearBtn}
              >
                <Text style={[styles.clearBtnText, { color: colors.textMuted }]}>
                  Clear Notification History
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  headerActions: {
    minWidth: 60,
    alignItems: 'flex-end',
  },
  markReadBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  markReadText: {
    fontSize: 13,
    fontWeight: '600',
  },
  listContent: {
    paddingBottom: 20,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 0.8,
  },
  iconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  itemContent: {
    flex: 1,
    marginRight: 8,
  },
  itemHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  itemTitle: {
    fontSize: 14.5,
    flex: 1,
    marginRight: 8,
  },
  itemTime: {
    fontSize: 11.5,
  },
  itemMessage: {
    fontSize: 13,
    lineHeight: 18,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 6,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
  },
  emptyIconBg: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptySub: {
    fontSize: 13.5,
    textAlign: 'center',
    lineHeight: 20,
  },
  footer: {
    paddingVertical: 12,
    alignItems: 'center',
    borderTopWidth: 1,
  },
  clearBtn: {
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  clearBtnText: {
    fontSize: 12.5,
    fontWeight: '500',
  },
});
