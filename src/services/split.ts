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
  const totalShares = shareCounts.reduce((acc, s) => acc + s.shares, 0);
  if (totalShares <= 0 || totalPaise <= 0) {
    return shareCounts.map(s => ({ memberId: s.memberId, shareAmount: 0 }));
  }

  let allocated = 0;
  const results: MemberShare[] = shareCounts.map(s => {
    const amount = Math.floor((totalPaise * s.shares) / totalShares);
    allocated += amount;
    return { memberId: s.memberId, shareAmount: amount };
  });

  // Distribute remaining paise
  let remainder = totalPaise - allocated;
  for (let i = 0; i < results.length && remainder > 0; i++) {
    results[i].shareAmount += 1;
    remainder--;
  }

  return results;
}

/**
 * Splits total paise based on percentage points (each percentage 0-100).
 */
export function splitByPercentage(
  percentages: Array<{ memberId: string; percentage: number }>,
  totalPaise: number
): MemberShare[] {
  let allocated = 0;
  const results: MemberShare[] = percentages.map(p => {
    const amount = Math.floor((totalPaise * p.percentage) / 100);
    allocated += amount;
    return { memberId: p.memberId, shareAmount: amount };
  });

  let remainder = totalPaise - allocated;
  for (let i = 0; i < results.length && remainder > 0; i++) {
    results[i].shareAmount += 1;
    remainder--;
  }

  return results;
}
