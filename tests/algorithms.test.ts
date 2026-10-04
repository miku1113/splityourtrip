import { describe, test, expect } from '@jest/globals';
import { splitEqual, splitExact, splitByShares, splitByPercentage } from '../src/services/split';
import { calculateSettlement, validateTripBalances } from '../src/services/settle';
import { parseUpiReceipt } from '../src/services/upiParser';
import { generateSettlementWhatsAppMessage, formatINR } from '../src/services/shareMessage';

describe('Split Algorithms (Integer Paise)', () => {
  test('splitEqual divides 100 paise among 3 people giving 34, 33, 33', () => {
    const members = ['user1', 'user2', 'user3'];
    const result = splitEqual(100, members);
    expect(result).toHaveLength(3);
    expect(result[0].shareAmount).toBe(34);
    expect(result[1].shareAmount).toBe(33);
    expect(result[2].shareAmount).toBe(33);
    const sum = result.reduce((acc, curr) => acc + curr.shareAmount, 0);
    expect(sum).toBe(100);
  });

  test('splitEqual handles single person expense', () => {
    const result = splitEqual(5000, ['user1']);
    expect(result).toEqual([{ memberId: 'user1', shareAmount: 5000 }]);
  });

  test('splitExact validates correct sums', () => {
    const shares = [
      { memberId: 'user1', shareAmount: 4000 },
      { memberId: 'user2', shareAmount: 6000 },
    ];
    const validation = splitExact(shares, 10000);
    expect(validation.valid).toBe(true);
    expect(validation.diff).toBe(0);
  });

  test('splitByShares distributes proportional shares with remainder', () => {
    const shareCounts = [
      { memberId: 'couple', shares: 2 },
      { memberId: 'single', shares: 1 },
    ];
    const result = splitByShares(shareCounts, 10000); // 100.00 INR
    expect(result[0].shareAmount + result[1].shareAmount).toBe(10000);
    expect(result[0].shareAmount).toBe(6667);
    expect(result[1].shareAmount).toBe(3333);
  });
});

describe('Settle Algorithm (Debt Simplification)', () => {
  test('simplifies multi-person debt with minimal transactions', () => {
    // Rahul paid 18,000, Priya paid 12,300, Amit paid 12,000. Total = 42,300.
    // Each share = 14,100.
    // Rahul net = +3,900
    // Priya net = 12,300 - 14,100 = -1,800
    // Amit net = 12,000 - 14,100 = -2,100
    const net = {
      Rahul: 390000, // paise
      Priya: -180000,
      Amit: -210000,
    };

    expect(validateTripBalances(net)).toBe(true);
    const payments = calculateSettlement(net);
    expect(payments).toHaveLength(2);

    const totalTransferred = payments.reduce((acc, p) => acc + p.amount, 0);
    expect(totalTransferred).toBe(390000);
    expect(payments).toEqual(
      expect.arrayContaining([
        { from: 'Amit', to: 'Rahul', amount: 210000 },
        { from: 'Priya', to: 'Rahul', amount: 180000 },
      ])
    );
  });

  test('returns empty when everyone is already even', () => {
    const net = { Alice: 0, Bob: 0, Charlie: 0 };
    const payments = calculateSettlement(net);
    expect(payments).toEqual([]);
  });
});

describe('UPI Parser', () => {
  test('extracts amount, receiver and txn id from sample receipt text', () => {
    const sampleText = `
      Google Pay
      Paid to Cafe Coffee Day
      ₹450.00
      Completed
      UPI Transaction ID: 412345678901
    `;
    const parsed = parseUpiReceipt(sampleText);
    expect(parsed.app).toBe('gpay');
    expect(parsed.amountPaise).toBe(45000);
    expect(parsed.receiverName).toBe('Cafe Coffee Day');
    expect(parsed.upiTxnId).toBe('412345678901');
    expect(parsed.confidence.amount).toBeGreaterThanOrEqual(0.8);
  });

  test('extracts super.money payment receipt with Ambica pan center and ₹25', () => {
    const superMoneyOcr = `
      super.
      money
      Payment Successful
      ₹25
      September 30 at 10:15 PM
      To: Ambica pan center
      paytm.s20v0f2@pty
      From: MIHIR ASHOKKUMAR JAR
      xxxxxx0802@superyes
      UPI reference ID: 663994888700
      super money UPI YES BANK
      Get assured cashback on UPI spends
    `;
    const parsed = parseUpiReceipt(superMoneyOcr);
    expect(parsed.app).toBe('super.money');
    expect(parsed.amountPaise).toBe(2500); // ₹25 = 2500 paise
    expect(parsed.receiverName).toBe('Ambica pan center');
    expect(parsed.receiverVpa).toBe('paytm.s20v0f2@pty');
    expect(parsed.upiTxnId).toBe('663994888700');
    expect(parsed.suggestedCategory).toBe('Food');
  });

  test('extracts super.money from WhatsApp share message with link', () => {
    const whatsAppText = `Sent you payment via UPI using super.money. Let me know when you get it https://link.super.money/t8aUWfJLyMb`;
    const parsed = parseUpiReceipt(whatsAppText);
    expect(parsed.app).toBe('super.money');
  });

  test('extracts combined screenshot OCR + WhatsApp caption', () => {
    const superMoneyOcr = `
      Payment Successful
      ₹25
      To: Ambica pan center
      paytm.s20v0f2@pty
      UPI reference ID: 663994888700
    `;
    const whatsAppText = `Sent you payment via UPI using super.money. Let me know when you get it https://link.super.money/t8aUWfJLyMb`;
    const combined = `${superMoneyOcr}\n\n${whatsAppText}`;
    const parsed = parseUpiReceipt(combined);

    expect(parsed.app).toBe('super.money');
    expect(parsed.amountPaise).toBe(2500);
    expect(parsed.receiverName).toBe('Ambica pan center');
    expect(parsed.upiTxnId).toBe('663994888700');
  });

  test('extracts Bank debit SMS to merchant via UPI', () => {
    const sms = `Dear SBI User, your A/c ending 1234 debited by Rs.25.00 on 30Sep26 by UPI transfer to Ambica pan center Ref No 663994888700`;
    const parsed = parseUpiReceipt(sms);
    expect(parsed.amountPaise).toBe(2500);
    expect(parsed.receiverName).toBe('Ambica pan center');
    expect(parsed.upiTxnId).toBe('663994888700');
  });

  test('extracts PhonePe payment message', () => {
    const phonePeText = `Paid ₹350 to Sharma Sweets on PhonePe. Transaction ID: T2609301234567890`;
    const parsed = parseUpiReceipt(phonePeText);
    expect(parsed.app).toBe('phonepe');
    expect(parsed.amountPaise).toBe(35000);
    expect(parsed.receiverName).toBe('Sharma Sweets');
    expect(parsed.suggestedCategory).toBe('Food');
  });
});

describe('WhatsApp Summary Message Generator', () => {
  test('generates expected settlement text message', () => {
    const message = generateSettlementWhatsAppMessage({
      tripName: 'Goa Trip 2026',
      totalSpentPaise: 4230000,
      paidByMembers: [
        { name: 'Rahul', amountPaise: 1800000 },
        { name: 'Priya', amountPaise: 1230000 },
        { name: 'Amit', amountPaise: 1200000 },
      ],
      settlements: [
        { from: 'amit_id', to: 'rahul_id', amount: 350000 },
        { from: 'priya_id', to: 'rahul_id', amount: 120000 },
      ],
      memberNames: {
        rahul_id: 'Rahul',
        priya_id: 'Priya',
        amit_id: 'Amit',
      },
    });

    expect(message).toContain('Goa Trip 2026 - Final Settlement');
    expect(message).toContain('Total spent: ₹ 42,300');
    expect(message).toContain('Amit -> Rahul: ₹ 3,500');
    expect(message).toContain('Priya -> Rahul: ₹ 1,200');
  });
});
