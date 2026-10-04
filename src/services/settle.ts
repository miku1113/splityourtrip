/**
 * Pure settlement (debt simplification) algorithm for Split Your Trip.
 * Uses integer paise amounts.
 * No React or Supabase imports.
 */

export interface PaymentTransaction {
  from: string; // memberId who owes
  to: string; // memberId who is owed
  amount: number; // in paise
}

export interface MemberBalanceRecord {
  memberId: string;
  totalPaid: number; // in paise
  totalShare: number; // in paise
  totalRepaid: number; // in paise
  totalReceived: number; // in paise
  net: number; // in paise: positive = gets money back, negative = owes
}

/**
 * Computes the minimum number of transactions needed to clear all debts.
 * @param netBalances Map of memberId -> net amount in paise.
 *        Positive net: group owes this member.
 *        Negative net: member owes the group.
 */
export function calculateSettlement(netBalances: Record<string, number>): PaymentTransaction[] {
  const cred: Array<{ id: string; v: number }> = [];
  const debt: Array<{ id: string; v: number }> = [];
  const out: PaymentTransaction[] = [];

  for (const [id, v] of Object.entries(netBalances)) {
    if (v > 0) {
      cred.push({ id, v });
    } else if (v < 0) {
      debt.push({ id, v: -v });
    }
  }

  // Sort descending by amount to minimize payments
  cred.sort((a, b) => b.v - a.v);
  debt.sort((a, b) => b.v - a.v);

  let i = 0;
  let j = 0;

  while (i < cred.length && j < debt.length) {
    const amt = Math.min(cred[i].v, debt[j].v);
    if (amt > 0) {
      out.push({
        from: debt[j].id,
        to: cred[i].id,
        amount: amt,
      });
    }

    cred[i].v -= amt;
    debt[j].v -= amt;

    if (cred[i].v === 0) i++;
    if (debt[j].v === 0) j++;
  }

  return out;
}

/**
 * Validates that all net balances across the trip sum to zero (accounting invariant).
 */
export function validateTripBalances(netBalances: Record<string, number>): boolean {
  const sum = Object.values(netBalances).reduce((acc, curr) => acc + curr, 0);
  return sum === 0;
}
