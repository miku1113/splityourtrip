import { PaymentTransaction } from './settle';
import { formatCurrencyAmount } from './currency';

export interface SettlementSummaryInput {
  tripName: string;
  totalSpentPaise: number;
  paidByMembers: Array<{ name: string; amountPaise: number }>;
  settlements: PaymentTransaction[];
  memberNames: Record<string, string>;
  currencyCode?: string;
}

export function formatINR(paise: number): string {
  return formatCurrencyAmount(paise, 'INR');
}

export function generateSettlementWhatsAppMessage(data: SettlementSummaryInput): string {
  const code = data.currencyCode || 'INR';
  const totalFormatted = formatCurrencyAmount(data.totalSpentPaise, code);

  const paidBreakdown = data.paidByMembers
    .map(p => `${p.name}: ${formatCurrencyAmount(p.amountPaise, code)}`)
    .join(' | ');

  let settleLines = 'All settled up! No pending payments.';
  if (data.settlements.length > 0) {
    settleLines = data.settlements
      .map(s => {
        const fromName = data.memberNames[s.from] || 'Someone';
        const toName = data.memberNames[s.to] || 'Someone';
        return `${fromName} -> ${toName}: ${formatCurrencyAmount(s.amount, code)}`;
      })
      .join('\n');
  }

  return (
    `*${data.tripName} - Final Settlement*\n` +
    `Total spent: ${totalFormatted}\n\n` +
    `*Paid by each person*\n` +
    `${paidBreakdown}\n\n` +
    `*Who pays whom*\n` +
    `${settleLines}\n\n` +
    `Full breakdown in the Split Your Trip app.`
  );
}
