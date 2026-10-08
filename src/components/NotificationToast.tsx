import React, { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNotificationStore, AppNotification } from '../features/notifications/useNotificationStore';
import { useTheme } from '../theme/useThemeStore';

export default function NotificationToast() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const activeToast = useNotificationStore((s) => s.activeToast);
  const hideToast = useNotificationStore((s) => s.hideToast);
  const markAsRead = useNotificationStore((s) => s.markAsRead);

  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<any>(null);

  useEffect(() => {
    if (activeToast) {
      if (timerRef.current) clearTimeout(timerRef.current);

      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 70,
          friction: 9,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();

      // Auto dismiss after 4.5 seconds
      timerRef.current = setTimeout(() => {
        dismissToast();
      }, 4500);
    } else {
      dismissToast();
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [activeToast]);

  const dismissToast = () => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -120,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => {
      hideToast();
    });
  };

  if (!activeToast) return null;

  const handlePress = () => {
    markAsRead(activeToast.id);
    dismissToast();

    if (activeToast.tripId) {
      router.push(`/trip/${activeToast.tripId}` as any);
    } else if (activeToast.friendId) {
      router.push('/(tabs)/friends' as any);
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

  const iconInfo = getIconConfig(activeToast.type);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          top: Math.max(insets.top, 12) + 6,
          transform: [{ translateY }],
          opacity,
        },
      ]}
      pointerEvents="box-none"
    >
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={handlePress}
        style={[
          styles.card,
          {
            backgroundColor: isDark ? '#1E293B' : '#FFFFFF',
            borderColor: isDark ? 'rgba(255,255,255,0.1)' : '#E2E8F0',
            shadowColor: '#000000',
          },
        ]}
      >
        <View style={[styles.iconWrapper, { backgroundColor: iconInfo.bg }]}>
          <Ionicons name={iconInfo.name} size={20} color={iconInfo.color} />
        </View>

        <View style={styles.content}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {activeToast.title}
          </Text>
          <Text style={[styles.message, { color: colors.textSecondary }]} numberOfLines={2}>
            {activeToast.message}
          </Text>
        </View>

        <TouchableOpacity onPress={dismissToast} style={styles.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="close" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 99999,
    alignItems: 'center',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 12,
  },
  iconWrapper: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  content: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  message: {
    fontSize: 12.5,
    lineHeight: 17,
  },
  closeBtn: {
    padding: 4,
    marginLeft: 4,
  },
});
