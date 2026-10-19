import { AppStorage } from '../lib/storage';
import { useTripStore, normalizeExpensesForTrip, findMyMember } from '../features/trips/useTripStore';
import { TripMember } from '../types/database';

export interface AnalyzedExpenseItem {
  id: string;
  trip_id: string;
  trip_name: string;
  amount: number;
  description: string;
  category: string;
  payment_mode: string;
  dateStr: string;
  dateObj: Date;
  paid_by: string;
  payerName: string;
  isMyExpense: boolean;
  currency: string;
  mySharePaise: number;
}

export const CATEGORY_ICONS: Record<string, { icon: any; color: string; bg: string }> = {
  Food: { icon: 'fast-food', color: '#F59E0B', bg: '#FEF3C7' },
  Stay: { icon: 'bed', color: '#6366F1', bg: '#EEF2FF' },
  Fuel: { icon: 'car', color: '#EF4444', bg: '#FEE2E2' },
  Tickets: { icon: 'ticket', color: '#8B5CF6', bg: '#F3E8FF' },
  Groceries: { icon: 'cart', color: '#10B981', bg: '#ECFDF5' },
  General: { icon: 'pricetag', color: '#3B82F6', bg: '#EFF6FF' },
  Shopping: { icon: 'bag-handle', color: '#EC4899', bg: '#FCE7F3' },
  Entertainment: { icon: 'film', color: '#F97316', bg: '#FFEDD5' },
};

export const SORT_OPTIONS = [
  { id: 'date_desc', label: 'Newest First', icon: 'calendar-outline' },
  { id: 'date_asc', label: 'Oldest First', icon: 'hourglass-outline' },
  { id: 'amount_desc', label: 'Amount: High to Low', icon: 'arrow-down-outline' },
  { id: 'amount_asc', label: 'Amount: Low to High', icon: 'arrow-up-outline' },
  { id: 'name_asc', label: 'Title: A to Z', icon: 'text-outline' },
] as const;

export type SortOptionId = (typeof SORT_OPTIONS)[number]['id'];

export async function fetchAllTripsExpenses(
  userId?: string,
  currentUserPhone?: string,
  userCurrency = 'INR'
): Promise<AnalyzedExpenseItem[]> {
  const currentTrips = useTripStore.getState().trips || [];
  const seenTripIds = new Set<string>();
  const uniqueTrips = currentTrips.filter(t => {
    if (!t?.id || seenTripIds.has(t.id)) return false;
    seenTripIds.add(t.id);
    return true;
  });

  const items: AnalyzedExpenseItem[] = [];

  for (const t of uniqueTrips) {
    let tMembers: TripMember[] = [];
    let tExpenses: any[] = [];

    try {
      const raw = await AppStorage.getItem(`@splityourtrip_local_details_${t.id}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        tMembers = Array.isArray(parsed.members) ? parsed.members : [];
        tExpenses = Array.isArray(parsed.expenses) ? parsed.expenses : [];
      }
    } catch {}

    if (tMembers.length === 0) {
      tMembers = useTripStore.getState().members.filter(m => m.trip_id === t.id);
    }
    if (tExpenses.length === 0) {
      tExpenses = useTripStore.getState().expenses.filter(e => e.trip_id === t.id);
    }

    const normalizedExps = normalizeExpensesForTrip(tExpenses, tMembers);
    const myMember = findMyMember(tMembers, userId, currentUserPhone) || tMembers[0];

    for (const exp of normalizedExps) {
      const rawDate = exp.date || exp.expense_date || exp.created_at || new Date().toISOString();
      const dObj = new Date(rawDate);
      const validDateObj = isNaN(dObj.getTime()) ? new Date() : dObj;

      const pMember = tMembers.find(
        m => m.id === exp.paid_by || (m.profile_id && m.profile_id === exp.paid_by)
      );
      const payerName = exp.payerName || pMember?.display_name || 'Member';
      const isMyExpense = Boolean(
        myMember &&
          (exp.paid_by === myMember.id ||
            (myMember.profile_id && exp.paid_by === myMember.profile_id))
      );

      let mySharePaise = 0;
      if (Array.isArray(exp.splits) && exp.splits.length > 0) {
        const mySplit = exp.splits.find(
          (s: any) =>
            (myMember && s.member_id === myMember.id) ||
            (myMember?.profile_id && s.profile_id === myMember.profile_id)
        );
        if (mySplit) {
          mySharePaise = Number(mySplit.amount || mySplit.share_amount || 0);
        }
      } else if (tMembers.length > 0) {
        mySharePaise = Math.round((Number(exp.amount) || 0) / tMembers.length);
      }

      items.push({
        id: exp.id || `${t.id}-${Math.random()}`,
        trip_id: t.id,
        trip_name: t.name,
        amount: Number(exp.amount) || 0,
        description: exp.description || 'Expense',
        category: exp.category || 'General',
        payment_mode: exp.payment_mode || 'other',
        dateStr: rawDate,
        dateObj: validDateObj,
        paid_by: exp.paid_by,
        payerName,
        isMyExpense,
        currency: t.currency || userCurrency,
        mySharePaise,
      });
    }
  }

  return items;
}
