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
