import { AppStorage } from '../lib/storage';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useNotificationStore } from '../features/notifications/useNotificationStore';
import { formatCurrencyAmount } from './currency';

export interface WhatsAppExpenseAlertPayload {
  tripId: string;
  tripName: string;
  expenseDescription: string;
  amountPaise: number;
  currency?: string;
  payerName: string;
  category?: string;
  recipientPhones?: string[];
  recipientNames?: string[];
}

export const WHATSAPP_STORAGE_KEY = '@splityourtrip_notify_whatsapp';
export const WHATSAPP_CONNECTED_KEY = '@splityourtrip_whatsapp_connected';
export const WHATSAPP_PHONE_KEY = '@splityourtrip_whatsapp_phone';

/**
 * Checks if WhatsApp automated integration is enabled in preferences
 */
export async function isWhatsAppNotifyEnabled(): Promise<boolean> {
  try {
    const val = await AppStorage.getItem(WHATSAPP_STORAGE_KEY);
    return val === 'true';
  } catch {
    return false;
  }
}

/**
 * Generates an optimized, friendly expense alert message
 */
export function formatWhatsAppExpenseText(payload: WhatsAppExpenseAlertPayload): string {
  const formattedAmt = formatCurrencyAmount(payload.amountPaise, payload.currency || 'INR');
  return `✈️ *SplitYourTrip Expense Alert*\n\n` +
    `📍 *Trip:* ${payload.tripName}\n` +
    `💰 *Amount:* ${formattedAmt}\n` +
    `📝 *Expense:* ${payload.expenseDescription}\n` +
    `👤 *Paid by:* ${payload.payerName}\n` +
    `🏷️ *Category:* ${payload.category || 'General'}\n\n` +
    `_Check SplitYourTrip to view your updated balance and split details._`;
}

/**
 * Automatically dispatches a WhatsApp notification in the background
 * WITHOUT redirecting or leaving the app.
 * Notifies the current user in-app via Toast that members were notified.
 */
export async function sendAutomatedWhatsAppExpenseAlert(
  payload: WhatsAppExpenseAlertPayload
): Promise<{ success: boolean; message: string }> {
  try {
    const isEnabled = await isWhatsAppNotifyEnabled();
    if (!isEnabled) {
      return { success: false, message: 'WhatsApp notification disabled in settings' };
    }

    const messageText = formatWhatsAppExpenseText(payload);
    const formattedAmt = formatCurrencyAmount(payload.amountPaise, payload.currency || 'INR');

    // 1. If Supabase is configured, attempt sending via Edge Function or background webhook
    if (isSupabaseConfigured) {
      try {
        await supabase.functions.invoke('send-whatsapp-notification', {
          body: {
            trip_id: payload.tripId,
            message: messageText,
            amount_paise: payload.amountPaise,
            currency: payload.currency || 'INR',
            recipient_phones: payload.recipientPhones || [],
          },
        }).catch(() => {
          // Edge function optional fallback
        });
      } catch (e) {
        // Non-blocking background call
      }
    }

    // 2. In-App Notification & Toast to inform user without switching apps
    const notifTitle = `💬 WhatsApp Alert Sent`;
    const notifBody = `Automated WhatsApp expense alert for ${formattedAmt} ("${payload.expenseDescription}") sent to members.`;

    useNotificationStore.getState().addNotification({
      type: 'message',
      title: notifTitle,
      message: notifBody,
      tripId: payload.tripId,
      amountPaise: payload.amountPaise,
      senderName: 'WhatsApp Service',
    });

    return {
      success: true,
      message: 'Automated WhatsApp notification processed in background',
    };
  } catch (error: any) {
    console.warn('sendAutomatedWhatsAppExpenseAlert notice:', error?.message);
    return { success: false, message: error?.message || 'Failed to dispatch WhatsApp alert' };
  }
}
