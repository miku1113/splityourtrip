import { create } from 'zustand';
import { AppStorage } from '../../lib/storage';

export type NotificationType =
  | 'message'
  | 'expense'
  | 'trip_member_added'
  | 'trip_member_removed'
  | 'payment_request'
  | 'payment_claim'
  | 'payment_accepted'
  | 'payment_rejected';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  tripId?: string;
  tripName?: string;
  friendId?: string;
  amountPaise?: number;
  senderId?: string;
  senderName?: string;
  messageId?: string;
  screenshotUrl?: string;
  metadata?: any;
}

interface NotificationState {
  notifications: AppNotification[];
  unreadCount: number;
  activeToast: AppNotification | null;

  // Actions
  addNotification: (notif: Omit<AppNotification, 'id' | 'timestamp' | 'read'>) => void;
  showToast: (notif: AppNotification) => void;
  hideToast: () => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAllNotifications: () => void;
  loadNotifications: (userId?: string) => Promise<void>;
}

const STORAGE_KEY_PREFIX = '@splityourtrip_user_notifications_';

function getNotificationStorageKey(userId?: string): string {
  if (userId) return `${STORAGE_KEY_PREFIX}${userId}`;
  try {
    const { useAuthStore } = require('../auth/useAuthStore');
    const uId = useAuthStore.getState().user?.id;
    if (uId) return `${STORAGE_KEY_PREFIX}${uId}`;
  } catch {}
  return `${STORAGE_KEY_PREFIX}guest`;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  activeToast: null,

  showToast: (notif: AppNotification) => {
    set({ activeToast: notif });
  },

  hideToast: () => {
    set({ activeToast: null });
  },

  addNotification: (item) => {
    const newNotif: AppNotification = {
      ...item,
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      read: false,
    };

    set((state) => {
      // Avoid exact duplicates within 2 seconds
      const isDuplicate = state.notifications.some(
        n => n.type === newNotif.type && n.tripId === newNotif.tripId && n.message === newNotif.message &&
          Math.abs(new Date(n.timestamp).getTime() - new Date(newNotif.timestamp).getTime()) < 2500
      );
      if (isDuplicate) return state;

      const updated = [newNotif, ...state.notifications].slice(0, 80);
      const unreadCount = updated.filter(n => !n.read).length;

      // Save to user-partitioned persistent storage
      try {
        const key = getNotificationStorageKey();
        AppStorage.setItem(key, JSON.stringify(updated)).catch(() => {});
      } catch {}

      // Post native system OS notification to Android/iOS notification drawer
      try {
        const { scheduleLocalNotification } = require('../../services/pushNotificationService');
        scheduleLocalNotification(newNotif.title, newNotif.message, { tripId: newNotif.tripId });
      } catch {}

      return {
        notifications: updated,
        unreadCount,
        activeToast: newNotif, // Trigger in-app toast automatically
      };
    });
  },

  markAsRead: (id: string) => {
    set((state) => {
      const updated = state.notifications.map(n => n.id === id ? { ...n, read: true } : n);
      const unreadCount = updated.filter(n => !n.read).length;
      try {
        const key = getNotificationStorageKey();
        AppStorage.setItem(key, JSON.stringify(updated)).catch(() => {});
      } catch {}
      return { notifications: updated, unreadCount };
    });
  },

  markAllAsRead: () => {
    set((state) => {
      const updated = state.notifications.map(n => ({ ...n, read: true }));
      try {
        const key = getNotificationStorageKey();
        AppStorage.setItem(key, JSON.stringify(updated)).catch(() => {});
      } catch {}
      return { notifications: updated, unreadCount: 0 };
    });
  },

  clearAllNotifications: () => {
    try {
      const key = getNotificationStorageKey();
      AppStorage.removeItem(key).catch(() => {});
      AppStorage.removeItem(`${STORAGE_KEY_PREFIX}current`).catch(() => {});
    } catch {}
    set({ notifications: [], unreadCount: 0, activeToast: null });
  },

  loadNotifications: async (userId?: string) => {
    try {
      const key = getNotificationStorageKey(userId);
      const raw = await AppStorage.getItem(key);
      if (raw) {
        const parsed: AppNotification[] = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const unreadCount = parsed.filter(n => !n.read).length;
          set({ notifications: parsed, unreadCount });
          return;
        }
      }
      set({ notifications: [], unreadCount: 0 });
    } catch {}
  },
}));
