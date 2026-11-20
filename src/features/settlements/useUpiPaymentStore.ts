import { create } from 'zustand';
import { AppState, AppStateStatus, Linking, Alert } from 'react-native';
import { AppStorage } from '../../lib/storage';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { useTripStore, isValidUUID } from '../trips/useTripStore';
import { useAuthStore } from '../auth/useAuthStore';
import { useContactsStore } from '../contacts/useContactsStore';
import { useNotificationStore } from '../notifications/useNotificationStore';
import { formatCurrencyAmount } from '../../services/currency';
import { uploadImageToSupabase } from '../../services/imageUpload';

export interface PendingUpiPayment {
  id: string;
  amountPaise: number;
  receiverName: string;
  receiverPhone?: string | null;
  receiverUpiId?: string | null;
  fromMemberId: string;
  toMemberId: string;
  tripId: string;
  tripName?: string;
  currency?: string;
  initiatedAt: number;
}

export function buildUpiUrl(params: {
  receiverName: string;
  amountPaise: number;
  receiverUpiId?: string | null;
  receiverPhone?: string | null;
  note?: string;
}): string {
  const rupees = (params.amountPaise / 100).toFixed(2);
  const queryParts: string[] = [];

  const vpa = params.receiverUpiId?.trim();
  if (vpa) {
    queryParts.push(`pa=${encodeURIComponent(vpa)}`);
  }
  queryParts.push(`pn=${encodeURIComponent(params.receiverName.trim() || 'Member')}`);
  queryParts.push(`am=${rupees}`);
  queryParts.push('cu=INR');
  const note = params.note || 'SplitYourTrip Settlement';
  queryParts.push(`tn=${encodeURIComponent(note)}`);

  return `upi://pay?${queryParts.join('&')}`;
}

const STORAGE_KEY = '@splityourtrip_pending_upi_payment';
let appStateSubscription: any = null;

interface UpiPaymentState {
  pendingPayment: PendingUpiPayment | null;
  showConfirmModal: boolean;
  isSubmitting: boolean;

  initUpiListener: () => void;
  startUpiPayment: (params: {
    amountPaise: number;
    receiverName: string;
    receiverPhone?: string | null;
    receiverUpiId?: string | null;
    fromMemberId: string;
    toMemberId: string;
    tripId: string;
    tripName?: string;
    currency?: string;
  }) => Promise<boolean>;
  dismissConfirmModal: () => void;
  confirmAndSettle: (screenshotUri?: string | null) => Promise<boolean>;
}

export const useUpiPaymentStore = create<UpiPaymentState>((set, get) => ({
  pendingPayment: null,
  showConfirmModal: false,
  isSubmitting: false,

  initUpiListener: () => {
    if (appStateSubscription) return;

    // Load any persisted pending payment
    AppStorage.getItem(STORAGE_KEY).then(raw => {
      if (raw) {
        try {
          const parsed: PendingUpiPayment = JSON.parse(raw);
          // If within the last 30 minutes, restore it
          if (Date.now() - parsed.initiatedAt < 30 * 60 * 1000) {
            set({ pendingPayment: parsed });
          } else {
            AppStorage.removeItem(STORAGE_KEY).catch(() => {});
          }
        } catch {}
      }
    });

    let previousState: AppStateStatus = AppState.currentState;

    appStateSubscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const cameFromBackground =
        (previousState === 'background' || previousState === 'inactive') &&
        nextState === 'active';
      previousState = nextState;

      if (cameFromBackground) {
        const pending = get().pendingPayment;
        if (pending) {
          // If at least 1 second passed since opening the external UPI app
          const elapsed = Date.now() - pending.initiatedAt;
          if (elapsed > 1000) {
            set({ showConfirmModal: true });
          }
        }
      }
    });
  },

  startUpiPayment: async params => {
    const paymentId = `upi_${Date.now()}`;
    const pending: PendingUpiPayment = {
      id: paymentId,
      amountPaise: params.amountPaise,
      receiverName: params.receiverName,
      receiverPhone: params.receiverPhone || null,
      receiverUpiId: params.receiverUpiId || null,
      fromMemberId: params.fromMemberId,
      toMemberId: params.toMemberId,
      tripId: params.tripId,
      tripName: params.tripName,
      currency: params.currency || 'INR',
      initiatedAt: Date.now(),
    };

    set({ pendingPayment: pending, showConfirmModal: false });
    await AppStorage.setItem(STORAGE_KEY, JSON.stringify(pending)).catch(() => {});

    // Ensure listener is active
    get().initUpiListener();

    // Construct valid UPI URL
    const upiUrl = buildUpiUrl({
      receiverName: params.receiverName,
      amountPaise: params.amountPaise,
      receiverUpiId: params.receiverUpiId,
      receiverPhone: params.receiverPhone,
      note: params.tripName ? `Settlement for ${params.tripName}` : 'SplitYourTrip Settlement',
    });

    try {
      const supported = await Linking.canOpenURL('upi://pay').catch(() => false);
      if (!supported) {
        // Fallback: try opening directly anyway (Android intent chooser often accepts it)
        await Linking.openURL(upiUrl);
      } else {
        await Linking.openURL(upiUrl);
      }
      return true;
    } catch (err: any) {
      console.warn('Could not launch UPI app:', err?.message);
      // Even if direct launch fails, keep modal option available so user can confirm if they switched manually
      setTimeout(() => {
        set({ showConfirmModal: true });
      }, 500);
      return false;
    }
  },

  dismissConfirmModal: () => {
    set({ showConfirmModal: false, pendingPayment: null });
    AppStorage.removeItem(STORAGE_KEY).catch(() => {});
  },

  confirmAndSettle: async (screenshotUri?: string | null) => {
    const pending = get().pendingPayment;
    if (!pending) return false;

    set({ isSubmitting: true });
    try {
      const tripStore = useTripStore.getState();
      const authStore = useAuthStore.getState();
      const currentUserId = authStore.user?.id || 'local_user';
      const payerName = authStore.profile?.full_name || authStore.profile?.name || 'You';

      // 1. Upload proof screenshot if provided
      let cloudScreenshotUrl: string | null = null;
      if (screenshotUri && isSupabaseConfigured) {
        try {
          const ext = screenshotUri.split('.').pop()?.split('?')[0] || 'jpg';
          const storagePath = `settlements/${pending.tripId}/${Date.now()}_proof.${ext}`;
          const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
          cloudScreenshotUrl = await uploadImageToSupabase('attachments', storagePath, screenshotUri, mimeType);
        } catch (upErr) {
          console.warn('Screenshot upload notice:', upErr);
          cloudScreenshotUrl = screenshotUri;
        }
      }

      // 2. Add settlement expense to deduct from balances mathematically
      const desc = `📱 UPI Settlement: ${payerName} paid ${pending.receiverName}`;
      await tripStore.addExpense({
        tripId: pending.tripId,
        amountPaise: pending.amountPaise,
        description: desc,
        category: 'settlement',
        paidByMemberId: pending.fromMemberId,
        paymentMode: 'upi',
        splitType: 'exact',
        participantMemberIds: [pending.toMemberId],
        customSplits: [{ memberId: pending.toMemberId, shareAmount: pending.amountPaise }],
        attachmentUrl: cloudScreenshotUrl || screenshotUri || null,
        userId: currentUserId,
      });

      // 3. Insert record into public.settlement_payments in Supabase
      if (isSupabaseConfigured && isValidUUID(pending.tripId)) {
        try {
          await supabase.from('settlement_payments').insert({
            trip_id: pending.tripId,
            from_member: pending.fromMemberId,
            to_member: pending.toMemberId,
            amount: pending.amountPaise,
            method: 'upi',
            note: 'Paid via UPI auto-settlement',
            paid_at: new Date().toISOString(),
          });
        } catch (spErr) {
          console.log('settlement_payments insert notice:', spErr);
        }
      }

      // 4. Send settlement card message into trip chat
      try {
        const payload = {
          type: 'payment_settlement',
          amountPaise: pending.amountPaise,
          payerId: pending.fromMemberId,
          payerName,
          receiverId: pending.toMemberId,
          receiverName: pending.receiverName,
          paymentMode: 'upi',
          status: 'accepted',
          settledAt: new Date().toISOString(),
          tripId: pending.tripId,
          note: 'Paid via UPI auto-settlement',
          mediaUrl: cloudScreenshotUrl || screenshotUri || undefined,
          screenshotUrl: cloudScreenshotUrl || screenshotUri || undefined,
        };
        await tripStore.sendMessage(
          pending.tripId,
          currentUserId,
          payerName,
          JSON.stringify(payload),
          cloudScreenshotUrl || screenshotUri
            ? {
                type: 'image',
                url: (cloudScreenshotUrl || screenshotUri) as string,
                name: 'Payment_Screenshot.jpg',
              }
            : undefined,
          'group'
        );
      } catch {}

      // 5. Notify receiver
      useNotificationStore.getState().addNotification({
        type: 'payment_claim',
        title: `💸 UPI Settlement: ${formatCurrencyAmount(pending.amountPaise, pending.currency || 'INR')}`,
        message: `${payerName} settled ${formatCurrencyAmount(pending.amountPaise, pending.currency || 'INR')} to ${pending.receiverName} via UPI. Balances updated!`,
        tripId: pending.tripId,
      });

      // 6. Refresh data stores
      useContactsStore.getState().fetchFriendsSummary(currentUserId).catch(() => {});
      tripStore.loadTripDetails(pending.tripId).catch(() => {});
      tripStore.fetchTrips(currentUserId).catch(() => {});

      // Clear pending payment
      set({ showConfirmModal: false, pendingPayment: null, isSubmitting: false });
      await AppStorage.removeItem(STORAGE_KEY).catch(() => {});

      Alert.alert(
        'Settled! 🎉',
        `${formatCurrencyAmount(pending.amountPaise, pending.currency || 'INR')} paid to ${pending.receiverName} has been deducted from balances.`
      );
      return true;
    } catch (e: any) {
      console.warn('confirmAndSettle error:', e);
      set({ isSubmitting: false });
      Alert.alert('Error', e?.message || 'Could not record settlement.');
      return false;
    }
  },
}));
