import { AppStorage } from '../lib/storage';

export interface CurrencyItem {
  code: string;
  symbol: string;
  name: string;
  country: string;
  flag: string;
  dialCode: string;
}

export const SUPPORTED_CURRENCIES: CurrencyItem[] = [
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', country: 'India', flag: '🇮🇳', dialCode: '+91' },
  { code: 'USD', symbol: '$', name: 'US Dollar', country: 'United States', flag: '🇺🇸', dialCode: '+1' },
  { code: 'EUR', symbol: '€', name: 'Euro', country: 'European Union', flag: '🇪🇺', dialCode: '+49' },
  { code: 'GBP', symbol: '£', name: 'British Pound', country: 'United Kingdom', flag: '🇬🇧', dialCode: '+44' },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham', country: 'United Arab Emirates', flag: '🇦🇪', dialCode: '+971' },
  { code: 'CAD', symbol: 'CA$', name: 'Canadian Dollar', country: 'Canada', flag: '🇨🇦', dialCode: '+1' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', country: 'Australia', flag: '🇦🇺', dialCode: '+61' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', country: 'Singapore', flag: '🇸🇬', dialCode: '+65' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', country: 'Japan', flag: '🇯🇵', dialCode: '+81' },
  { code: 'SAR', symbol: '﷼', name: 'Saudi Riyal', country: 'Saudi Arabia', flag: '🇸🇦', dialCode: '+966' },
  { code: 'THB', symbol: '฿', name: 'Thai Baht', country: 'Thailand', flag: '🇹🇭', dialCode: '+66' },
  { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit', country: 'Malaysia', flag: '🇲🇾', dialCode: '+60' },
  { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc', country: 'Switzerland', flag: '🇨🇭', dialCode: '+41' },
  { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar', country: 'New Zealand', flag: '🇳🇿', dialCode: '+64' },
  { code: 'QAR', symbol: 'QR', name: 'Qatari Riyal', country: 'Qatar', flag: '🇶🇦', dialCode: '+974' },
];

export function getCurrencyInfo(currencyCode?: string | null): CurrencyItem {
  if (!currencyCode) return SUPPORTED_CURRENCIES[0];
  const found = SUPPORTED_CURRENCIES.find(
    c => c.code.toUpperCase() === currencyCode.toUpperCase()
  );
  return found || SUPPORTED_CURRENCIES[0];
}

export function formatCurrencyAmount(amountPaise: number, currencyCode?: string | null): string {
  const info = getCurrencyInfo(currencyCode);
  const units = (amountPaise / 100).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${info.symbol} ${units}`;
}

export async function getUserCurrencyPreference(): Promise<string> {
  try {
    const saved = await AppStorage.getItem('@splityourtrip_user_currency');
    if (saved) return saved;
  } catch {}
  return 'INR';
}

export async function setUserCurrencyPreference(currencyCode: string): Promise<void> {
  try {
    await AppStorage.setItem('@splityourtrip_user_currency', currencyCode.toUpperCase());
  } catch {}
}
