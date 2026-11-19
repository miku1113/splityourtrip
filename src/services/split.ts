/**
 * Pure splitting algorithms for Split Your Trip.
 * All amounts are strictly integer paise (1 INR = 100 paise).
 * No React or Supabase imports.
 */

export interface MemberShare {
  memberId: string;
  shareAmount: number; // in paise
}

/**
 * Splits total paise equally among member IDs.
 * Leftover paise are distributed 1 paise at a time to early participants
 * so that the sum of shares is guaranteed to match totalPaise exactly.
 */
export function splitEqual(totalPaise: number, memberIds: string[]): MemberShare[] {
  if (memberIds.length === 0) return [];
  if (totalPaise <= 0) {
    return memberIds.map(memberId => ({ memberId, shareAmount: 0 }));
  }

  const count = memberIds.length;
  const base = Math.floor(totalPaise / count);
  let remainder = totalPaise - base * count;

  return memberIds.map(memberId => {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder--;
    return {
      memberId,
      shareAmount: base + extra,
    };
  });
}

/**
 * Validates and normalizes exact split entries.
 * Returns true if sum equals totalPaise, throws or returns error otherwise.
 */
export function splitExact(
  exactShares: Array<{ memberId: string; shareAmount: number }>,
  expectedTotalPaise: number
): { valid: boolean; total: number; diff: number } {
  const sum = exactShares.reduce((acc, curr) => acc + Math.round(curr.shareAmount), 0);
  return {
    valid: sum === expectedTotalPaise,
    total: sum,
    diff: expectedTotalPaise - sum,
  };
}

/**
 * Splits total paise based on proportional shares (e.g. 2 shares for couple, 1 share for single).
 */
export function splitByShares(
  shareCounts: Array<{ memberId: string; shares: number }>,
  totalPaise: number
): MemberShare[] {
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 0) {
    throw new RangeError('Total amount must be a non-negative integer number of paise.');
  }
  if (shareCounts.length === 0) {
    if (totalPaise !== 0) throw new RangeError('A share split needs at least one participant.');
    return [];
  }
  if (shareCounts.some(item => !Number.isFinite(item.shares) || item.shares <= 0)) {
    throw new RangeError('Each participant must have a positive share count.');
  }
  const totalShares = shareCounts.reduce((acc, s) => acc + s.shares, 0);
  if (!Number.isFinite(totalShares) || totalShares <= 0) {
    throw new RangeError('Total share count must be finite and positive.');
  }

  const allocations = shareCounts.map((item, index) => {
    const exactAmount = totalPaise * (item.shares / totalShares);
    const shareAmount = Math.floor(exactAmount);
    return { memberId: item.memberId, shareAmount, fraction: exactAmount - shareAmount, index };
  });
  const allocated = allocations.reduce((sum, item) => sum + item.shareAmount, 0);
  const remainder = totalPaise - allocated;
  const remainderOrder = [...allocations].sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; i < remainder; i++) remainderOrder[i].shareAmount += 1;
  return allocations.map(({ memberId, shareAmount }) => ({ memberId, shareAmount }));
}

/**
 * Splits total paise based on percentage points (each percentage 0-100).
 */
export function splitByPercentage(
  percentages: Array<{ memberId: string; percentage: number }>,
  totalPaise: number
): MemberShare[] {
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 0) {
    throw new RangeError('Total amount must be a non-negative integer number of paise.');
  }
  if (percentages.length === 0) {
    if (totalPaise !== 0) throw new RangeError('A percentage split needs at least one participant.');
    return [];
  }
  if (percentages.some(p => !Number.isFinite(p.percentage) || p.percentage < 0 || p.percentage > 100)) {
    throw new RangeError('Each percentage must be between 0 and 100.');
  }
  const percentageTotal = percentages.reduce((sum, item) => sum + item.percentage, 0);
  if (Math.abs(percentageTotal - 100) > 1e-8) {
    throw new RangeError('Percentages must total exactly 100.');
  }

  const allocations = percentages.map((item, index) => {
    const exactAmount = totalPaise * (item.percentage / percentageTotal);
    const flooredAmount = Math.floor(exactAmount);
    return { memberId: item.memberId, shareAmount: flooredAmount, fraction: exactAmount - flooredAmount, index };
  });
  let remainder = totalPaise - allocations.reduce((sum, item) => sum + item.shareAmount, 0);
  const remainderOrder = [...allocations].sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; i < remainder; i++) remainderOrder[i].shareAmount += 1;
  return allocations.map(({ memberId, shareAmount }) => ({ memberId, shareAmount }));
}
