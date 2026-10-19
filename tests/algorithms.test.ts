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

  test('extracts Grand Total / Net Payable from restaurant receipt with taxes & items', () => {
    const restaurantBill = `
      CAFE DELHI HEIGHTS
      Table: 04  Order: #8921
      Date: 18-10-2026 Time: 14:32

      Juicy Lucy Burger    1    450    450.00
      Iced Americano       1    220    220.00
      Red Velvet Cake      1    280    280.00
      ---------------------------------------
      SUB TOTAL                        950.00
      CGST @ 2.5%                       23.75
      SGST @ 2.5%                       23.75
      Service Charge 5%                 47.50
      ---------------------------------------
      GRAND TOTAL                    1,045.00
      ROUND OFF                          0.00
      NET PAYABLE                    1,045.00
      ---------------------------------------
      Thank You! Visit Again
    `;
    const parsed = parseUpiReceipt(restaurantBill);
    expect(parsed.amountPaise).toBe(104500); // 1,045.00 -> 104500 paise
    expect(parsed.suggestedCategory).toBe('Food');
  });

  test('extracts Total Amount Due from supermarket receipt excluding Cash Tendered and Change', () => {
    const dmartBill = `
      RELIANCE SMART POINT
      STORE # 4102

      AMUL BUTTER 500G     1    275.00   275.00
      FORTUNE OIL 1L       2    145.00   290.00
      AASHIRVAAD ATTA 5K   1    240.00   240.00
      TATA SALT 1KG        1     28.00    28.00

      TOTAL ITEMS: 5
      SUB TOTAL: 833.00
      SAVINGS: 45.00
      TOTAL AMOUNT DUE: 833.00
      CASH TENDERED: 1000.00
      CHANGE: 167.00
    `;
    const parsed = parseUpiReceipt(dmartBill);
    expect(parsed.amountPaise).toBe(83300); // 833.00 -> 83300 paise
    expect(parsed.suggestedCategory).toBe('Groceries');
  });

  test('extracts two-line total from receipt', () => {
    const bill = `
      THE IRANI CHAI
      BILL NO: 402
      BUN MASKA             60.00
      IRANI CHAI            40.00
      SAMOSA (2 PCS)        50.00

      TOTAL
      150.00
    `;
    const parsed = parseUpiReceipt(bill);
    expect(parsed.amountPaise).toBe(15000);
  });

  test('extracts amount with Rs. and trailing dash /-', () => {
    const bill = `
      SHREE GANESH BHOJANALAYA
      THALI x 3: Rs. 450/-
      SWEET: Rs. 90/-
      NET AMOUNT PAYABLE: Rs. 540/-
    `;
    const parsed = parseUpiReceipt(bill);
    expect(parsed.amountPaise).toBe(54000);
  });

  test('extracts fuel / petrol pump sale amount', () => {
    const fuelBill = `
      INDIAN OIL CORPORATION
      PUMP NO: 02
      FUEL: PETROL
      VOLUME: 15.51 L
      SALE AMOUNT: Rs. 1500.00
    `;
    const parsed = parseUpiReceipt(fuelBill);
    expect(parsed.amountPaise).toBe(150000);
    expect(parsed.suggestedCategory).toBe('Fuel');
  });

  test('extracts hotel / stay invoice total with comma formatting', () => {
    const hotelBill = `
      HOTEL PALACE INN
      ROOM CHARGES (2 NIGHTS): 4000.00
      FOOD & BEVERAGES: 850.00
      CGST 6%: 303.00
      SGST 6%: 303.00
      INVOICE TOTAL: INR 5,656.00
    `;
    const parsed = parseUpiReceipt(hotelBill);
    expect(parsed.amountPaise).toBe(565600);
    expect(parsed.suggestedCategory).toBe('Stay');
  });

  test('extracts accurate Grand Total when line contains Table, Order, Cash and Change', () => {
    const bill = `
      PUNJABI TADKA
      Table: 4   Order: #8921   Waiter: 2
      Paneer Tikka     2    220.00    440.00
      Dal Makhani      1    260.00    260.00
      Butter Roti      6     25.00    150.00
      Grand Total: 850.00   Cash Tendered: 1000.00   Change Due: 150.00
      Thank You!
    `;
    const parsed = parseUpiReceipt(bill);
    expect(parsed.amountPaise).toBe(85000); // 850.00 -> 85000 paise (not 4, not 8921, not 1000, not 150)
    expect(parsed.suggestedCategory).toBe('Food');
  });

  test('extracts Total when line contains tax percentages like (incl 5% GST)', () => {
    const bill = `
      PIZZA HEAVEN
      Margherita Pizza   1   350.00
      Coke               1    50.00
      Total (incl. 5% GST): 420.00
    `;
    const parsed = parseUpiReceipt(bill);
    expect(parsed.amountPaise).toBe(42000); // 420.00 -> 42000 paise (not 5)
  });

  test('extracts Indian Lakh comma formatted amounts accurately', () => {
    const tourBill = `
      MAKEMYTRIP INDIA PVT LTD
      FLIGHT + RESORT PACKAGE (KASHMIR 6D/5N)
      NET PAYABLE AMOUNT: ₹ 1,45,000.00
    `;
    const parsed = parseUpiReceipt(tourBill);
    expect(parsed.amountPaise).toBe(14500000); // 1,45,000.00 -> 14500000 paise
    expect(parsed.suggestedCategory).toBe('Tickets');
  });

  test('extracts European comma decimal format', () => {
    const bill = `
      GLOBAL STORE
      ITEM A    100,00
      ITEM B    240,50
      TOTAL : 340,50
    `;
    const parsed = parseUpiReceipt(bill);
    expect(parsed.amountPaise).toBe(34050); // 340.50 -> 34050 paise
  });

  test('extracts bottom decimal number when bill has no keyword recognized', () => {
    const faintBill = `
      CHAI CORNER
      TEA              20.00
      SAMOSA           30.00
      MASKA BUN        40.00
      ----------------------
      90.00
    `;
    const parsed = parseUpiReceipt(faintBill);
    expect(parsed.amountPaise).toBe(9000); // 90.00 -> 9000 paise
  });

  test('extracts Google Pay P2P screenshot with contact, phone, amount and Completed status', () => {
    const gpayOcr = `
      Google Pay
      Khushi
      +91 95109 10300
      ₹1,810.50
      Completed • Oct 19, 2026, 11:02 PM
      UPI transaction ID: 429384729104
      To: Khushi
      State Bank of India •••• 1234
      From: Mihir Jariwala
      HDFC Bank •••• 5678
      Google transaction ID
      CICAgOD4q-6jHQ
    `;
    const parsed = parseUpiReceipt(gpayOcr);
    expect(parsed.app).toBe('gpay');
    expect(parsed.amountPaise).toBe(181050); // ₹1,810.50 -> 181050 paise
    expect(parsed.receiverName).toBe('Khushi');
    expect(parsed.upiTxnId).toBe('429384729104');
  });

  test('extracts Google Pay screenshot with integer amount and question mark OCR artifact', () => {
    const gpayOcr = `
      Google Pay
      Khushi
      +91 95109 10300
      ? 650
      Completed • 19 Oct 2026, 9:52 pm
      UPI transaction ID 429384729104
    `;
    const parsed = parseUpiReceipt(gpayOcr);
    expect(parsed.app).toBe('gpay');
    expect(parsed.amountPaise).toBe(65000); // ₹650 -> 65000 paise
    expect(parsed.receiverName).toBe('Khushi');
    expect(parsed.upiTxnId).toBe('429384729104');
  });

  test('extracts Google Pay screenshot with unadorned integer amount above Paid status', () => {
    const gpayOcr = `
      Google Pay
      Rahul Sharma
      rahul@okaxis
      1,500
      Paid • 19 Oct 2026, 8:45 pm
      UPI transaction ID: 412345678901
    `;
    const parsed = parseUpiReceipt(gpayOcr);
    expect(parsed.app).toBe('gpay');
    expect(parsed.amountPaise).toBe(150000); // ₹1,500 -> 150000 paise
    expect(parsed.receiverName).toBe('Rahul Sharma');
    expect(parsed.receiverVpa).toBe('rahul@okaxis');
    expect(parsed.upiTxnId).toBe('412345678901');
  });

  test('extracts Google Pay merchant payment with CICAg transaction ID and brand category', () => {
    const gpayMerchant = `
      Chai Point
      chaipoint@icici
      ₹ 150.00
      Completed • Oct 19, 2026, 8:30 AM
      UPI transaction ID: 429384729104
      To: CHAI POINT
      Google transaction ID: CICAgOD4q-test
    `;
    const parsed = parseUpiReceipt(gpayMerchant);
    expect(parsed.app).toBe('gpay');
    expect(parsed.amountPaise).toBe(15000); // ₹150.00 -> 15000 paise
    expect(parsed.receiverName).toBe('Chai Point');
    expect(parsed.suggestedCategory).toBe('Food');
  });

  test('extracts Google Pay chat bubble payment', () => {
    const chatBubble = `
      Paid
      ₹650
      Oct 19, 2026 • Completed
    `;
    const parsed = parseUpiReceipt(chatBubble);
    expect(parsed.amountPaise).toBe(65000);
  });

  test('extracts Blinkit quick commerce order bill with Groceries category', () => {
    const blinkitBill = `
      BLINKIT COMMERCE PRIVATE LIMITED
      ORDER # BK-982134
      TOTAL AMOUNT: ₹ 349.00
      PAID VIA UPI
    `;
    const parsed = parseUpiReceipt(blinkitBill);
    expect(parsed.amountPaise).toBe(34900);
    expect(parsed.receiverName).toBe('Blinkit');
    expect(parsed.suggestedCategory).toBe('Groceries');
  });

  test('extracts Namma Yatri transit ride receipt with Tickets category', () => {
    const transitBill = `
      NAMMA YATRI
      AUTO RIDE RECEIPT
      FARE: ₹ 85.00
      PAID TO DRIVER
    `;
    const parsed = parseUpiReceipt(transitBill);
    expect(parsed.amountPaise).toBe(8500);
    expect(parsed.receiverName).toBe('Namma Yatri');
    expect(parsed.suggestedCategory).toBe('Tickets');
  });

  test('extracts Google Pay ₹25,000 payment to Jainam Shah ignoring date (19 October 2026)', () => {
    const gpayOcr = `
      Google Pay
      Paid to Jainam Shah
      ₹25,000
      Completed • 19 October 2026, 11:34 pm
      UPI transaction ID: 629381726192
    `;
    const parsed = parseUpiReceipt(gpayOcr);
    expect(parsed.app).toBe('gpay');
    expect(parsed.amountPaise).toBe(2500000); // Must be ₹25,000 (2,500,000 paise), NOT ₹19 (1900 paise)!
    expect(parsed.receiverName).toBe('Jainam Shah');
    expect(parsed.upiTxnId).toBe('629381726192');
  });

  test('extracts ₹25,000 with OCR dot/space thousand separator or checkmark', () => {
    const ocrWithDot = `
      ✓ 25.000
      Paid to Jainam Shah
      19 October 2026
    `;
    const parsed = parseUpiReceipt(ocrWithDot);
    expect(parsed.amountPaise).toBe(2500000);
    expect(parsed.receiverName).toBe('Jainam Shah');
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
