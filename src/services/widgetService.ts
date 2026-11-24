import { NativeModules, Platform, Linking } from 'react-native';

const { SplitOcr } = NativeModules;

/**
 * Updates the text status displayed on the Android Home Screen Widget.
 */
export async function updateWidgetStatus(statusText: string): Promise<boolean> {
  if (Platform.OS !== 'android' || !SplitOcr?.updateWidgetStatus) {
    return false;
  }
  try {
    await SplitOcr.updateWidgetStatus(statusText);
    return true;
  } catch (err) {
    console.log('[widgetService] Failed to update widget status:', err);
    return false;
  }
}

/**
 * Syncs real-time balance and trip summary to the home screen widget.
 */
export async function syncWidgetSummary(params: {
  netBalancePaise?: number;
  activeTripName?: string;
  tripCount?: number;
}): Promise<void> {
  const { netBalancePaise, activeTripName, tripCount } = params;

  let text = 'Quick Split & Expense Manager';

  if (typeof netBalancePaise === 'number' && !isNaN(netBalancePaise)) {
    const rupees = (Math.abs(netBalancePaise) / 100).toFixed(0);
    if (netBalancePaise > 0) {
      text = `You are owed ₹${rupees}${tripCount ? ` • ${tripCount} trips` : ''}`;
    } else if (netBalancePaise < 0) {
      text = `You owe ₹${rupees}${tripCount ? ` • ${tripCount} trips` : ''}`;
    } else {
      text = `All settled up${tripCount ? ` • ${tripCount} trips` : ''}`;
    }
  } else if (activeTripName) {
    text = `Trip: ${activeTripName}`;
  } else if (tripCount && tripCount > 0) {
    text = `${tripCount} active ${tripCount === 1 ? 'trip' : 'trips'} ready`;
  }

  await updateWidgetStatus(text);
}

export interface PendingVoiceExpense {
  id: string;
  title: string;
  amount_paise: number;
  category: string;
  payer: string;
  split: string;
  created_at: string;
  synced: boolean;
}

/**
 * Checks and retrieves any pending expenses recorded via the Android Assistant Drawer overlay.
 */
export async function syncPendingAssistantVoiceExpenses(): Promise<PendingVoiceExpense[]> {
  if (Platform.OS !== 'android' || !SplitOcr?.getPendingVoiceExpenses) {
    return [];
  }
  try {
    const raw = await SplitOcr.getPendingVoiceExpenses();
    if (!raw) return [];
    const list: PendingVoiceExpense[] = JSON.parse(raw);
    if (Array.isArray(list) && list.length > 0) {
      if (SplitOcr.clearPendingVoiceExpenses) {
        await SplitOcr.clearPendingVoiceExpenses();
      }
      return list;
    }
  } catch (err) {
    console.log('[widgetService] Error syncing pending voice expenses:', err);
  }
  return [];
}

/**
 * Updates the active trip associated with the home screen widget & Assistant drawer.
 */
export async function updateWidgetActiveTrip(tripId: string, statusText?: string): Promise<boolean> {
  if (Platform.OS !== 'android' || !SplitOcr?.updateWidgetActiveTrip) {
    return false;
  }
  try {
    await SplitOcr.updateWidgetActiveTrip(tripId, statusText || '');
    return true;
  } catch (err) {
    console.log('[widgetService] Failed to update active trip on widget:', err);
    return false;
  }
}
