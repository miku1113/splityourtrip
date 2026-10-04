/**
 * Pure UPI Receipt and Payment Message parser for Split Your Trip.
 * Detects super.money, GPay, PhonePe, Paytm, Cred, BHIM, Navi, Amazon Pay receipts and messages.
 * Rule: Pure function with no React or Supabase imports.
 */

export interface ParsedPayment {
  app: 'super.money' | 'gpay' | 'phonepe' | 'paytm' | 'cred' | 'bhim' | 'navi' | 'amazon_pay' | 'whatsapp' | 'unknown';
  amountPaise?: number;
  receiverName?: string;
  receiverVpa?: string;
  upiTxnId?: string;
  suggestedCategory?: 'Food' | 'Stay' | 'Fuel' | 'Tickets' | 'Groceries' | 'General';
  paidAt?: string; // ISO date string
  confidence: {
    amount: number;
    receiver: number;
    txnId: number;
    date: number;
  };
  rawText: string;
}

/**
 * Parses raw OCR text extracted from a payment confirmation screenshot or shared UPI message.
 */
export function parseUpiReceipt(text: string): ParsedPayment {
  const normalized = (text || '').replace(/\r/g, '').trim();
  const lower = normalized.toLowerCase();
  const lines = normalized.split('\n').map(l => l.trim()).filter(Boolean);

  // 1. App detection
  let app: ParsedPayment['app'] = 'unknown';
  if (
    lower.includes('super.money') ||
    lower.includes('supermoney') ||
    lower.includes('link.super.money') ||
    lower.includes('@superyes') ||
    lower.includes('@superaxis')
  ) {
    app = 'super.money';
  } else if (
    lower.includes('google pay') ||
    lower.includes('gpay') ||
    lower.includes('@okaxis') ||
    lower.includes('@okhdfcbank') ||
    lower.includes('@okicici') ||
    lower.includes('@oksbi')
  ) {
    app = 'gpay';
  } else if (
    lower.includes('phonepe') ||
    lower.includes('phone pe') ||
    lower.includes('@ybl') ||
    lower.includes('@ibl') ||
    lower.includes('@axl')
  ) {
    app = 'phonepe';
  } else if (lower.includes('cred') || lower.includes('@cred')) {
    app = 'cred';
  } else if (lower.includes('bhim') || lower.includes('@upi')) {
    app = 'bhim';
  } else if (lower.includes('navi')) {
    app = 'navi';
  } else if (lower.includes('amazon pay') || lower.includes('@apl')) {
    app = 'amazon_pay';
  } else if (lower.includes('whatsapp') || lower.includes('@wa')) {
    app = 'whatsapp';
  } else if (lower.includes('paytm') || lower.includes('@paytm')) {
    app = 'paytm';
  }

  // 2. Receiver Name & VPA Extraction
  let receiverName: string | undefined;
  let receiverVpa: string | undefined;
  let receiverConfidence = 0;

  // Extract VPA first (e.g. paytm.s20v0f2@pty, user@okhdfcbank)
  const vpaMatch = normalized.match(/([a-zA-Z0-9.\-_]{2,35}@[a-zA-Z0-9]{2,15})/);
  if (vpaMatch && vpaMatch[1]) {
    receiverVpa = vpaMatch[1];
  }

  // Pattern A: "To: Ambica pan center", "To : Name", "Paid to: Name", "Transfer to Name"
  const toMatch = normalized.match(
    /(?:Paid to|Transfer to|Payment to|Sent to|Paid successfully to|To)\s*[:\-]?\s*([A-Za-z0-9 .,&'()\-]{2,50})/i
  );
  if (toMatch && toMatch[1]) {
    let candidate = toMatch[1].split('\n')[0].trim();
    // Strip trailing phrases common in SMS/WhatsApp (e.g. "Ref No...", "using Google Pay...", "on PhonePe...", "via UPI...")
    candidate = candidate.replace(/\s+(?:Ref|UPI|Txn|Transaction|via|using|on|from|dated?|at|A\/c|Acc)\b.*$/i, '').trim();
    // Ensure it's not a generic word or VPA
    if (
      candidate.length >= 2 &&
      !candidate.includes('@') &&
      !/^(upi|bank|completed|successful|rs|inr|account|payment|september|october|november|december|january|february|march|april|may|june|july|august)/i.test(
        candidate
      )
    ) {
      receiverName = candidate;
      receiverConfidence = 0.9;
    }
  }

  // Pattern B: Look for merchant name on the line immediately preceding a VPA (common in Indian receipts)
  if (!receiverName) {
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i];
      const nextLine = lines[i + 1];
      if (nextLine.includes('@') && !line.includes('@')) {
        const clean = line.replace(/^(?:to|paid to|transfer to)\s*[:\-]?\s*/i, '').trim();
        if (
          clean.length >= 2 &&
          !/^(from|date|upi|ref|txn|payment|super|google|phonepe|paytm|bhim|cred)/i.test(clean) &&
          !/^[0-9₹?*>\$]/.test(clean)
        ) {
          receiverName = clean;
          receiverConfidence = 0.85;
          break;
        }
      }
    }
  }

  // Pattern C: Multi-line check where a line is simply "To:" or "To" or "Paid to:"
  if (!receiverName) {
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^(?:paid to|transfer to|payment to|to)\s*[:\-]?$/i.test(lines[i])) {
        const nextLine = lines[i + 1].trim();
        if (
          nextLine.length >= 2 &&
          !nextLine.includes('@') &&
          !/^[0-9₹?*>\$]/.test(nextLine) &&
          !/^(upi|from|bank|successful)/i.test(nextLine)
        ) {
          receiverName = nextLine;
          receiverConfidence = 0.8;
          break;
        }
      }
    }
  }

  // Pattern D: VPA fallback ONLY if no human merchant name found
  if (!receiverName && receiverVpa) {
    const prefix = receiverVpa.split('@')[0];
    // Only use if it looks somewhat like a name (not random machine hash like paytm.s20v0f2)
    if (!/^[a-z0-9]{1,4}\.[a-z0-9]{6,}$/i.test(prefix)) {
      receiverName = prefix.charAt(0).toUpperCase() + prefix.slice(1);
      receiverConfidence = 0.5;
    }
  }

  // Clean trailing punctuation
  if (receiverName) {
    receiverName = receiverName.replace(/[•\-_:;]+$/, '').trim();
  }

  // 3. Amount Extraction
  let amountPaise: number | undefined;
  let amountConfidence = 0;

  // Strategy A: Direct currency symbol prefix (₹, \u20B9, ?, *, $, Rs., INR)
  const amountMatch = normalized.match(
    /(?:[₹\u20B9?*>\$]|Rs\.?|INR)\s*([0-9]{1,6}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?)/i
  );
  if (amountMatch && amountMatch[1]) {
    const cleanNum = amountMatch[1].replace(/,/g, '');
    const floatVal = parseFloat(cleanNum);
    if (!isNaN(floatVal) && floatVal > 0 && floatVal < 10000000) {
      amountPaise = Math.round(floatVal * 100);
      amountConfidence = 0.95;
    }
  }

  // Strategy B: Number on next line after "Payment Successful" / "Paid Successfully"
  if (!amountPaise) {
    for (let i = 0; i < lines.length; i++) {
      if (
        /payment\s+successful|paid\s+successfully|transaction\s+successful|transfer\s+successful|payment\s+received/i.test(
          lines[i]
        )
      ) {
        for (let j = i + 1; j <= Math.min(i + 3, lines.length - 1); j++) {
          const clean = lines[j].replace(/[₹\u20B9?*>\$\s]/g, '');
          if (/^[0-9]{1,6}(?:\.[0-9]{1,2})?$/.test(clean)) {
            const f = parseFloat(clean);
            if (f > 0 && f < 10000000 && f !== 2024 && f !== 2025 && f !== 2026) {
              amountPaise = Math.round(f * 100);
              amountConfidence = 0.9;
              break;
            }
          }
        }
        if (amountPaise) break;
      }
    }
  }

  // Strategy C: Text matches with "Paid", "Transfer", "Amount", "Sent", "debited by"
  if (!amountPaise) {
    const textMatch = normalized.match(
      /(?:paid|transfer|amount|total|sent|debited\s*(?:by|of)?)\s*(?:of)?\s*(?:[₹\u20B9?*>\$]|Rs\.?|INR)?\s*([0-9]{1,6}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?)/i
    );
    if (textMatch && textMatch[1]) {
      const clean = textMatch[1].replace(/,/g, '');
      const f = parseFloat(clean);
      if (!isNaN(f) && f > 0 && f < 10000000) {
        amountPaise = Math.round(f * 100);
        amountConfidence = 0.85;
      }
    }
  }

  // Strategy D: Standalone number on a line in the top 10 lines
  if (!amountPaise) {
    for (const line of lines.slice(0, 10)) {
      const clean = line.replace(/[₹\u20B9?*>\$\s]/g, '');
      if (/^[0-9]{1,6}(?:\.[0-9]{1,2})?$/.test(clean)) {
        const f = parseFloat(clean);
        if (f > 0 && f < 10000000 && f !== 2024 && f !== 2025 && f !== 2026) {
          amountPaise = Math.round(f * 100);
          amountConfidence = 0.75;
          break;
        }
      }
    }
  }

  // 4. UPI Transaction ID / Ref No / UTR (usually 12-digit number)
  let upiTxnId: string | undefined;
  let txnConfidence = 0;

  const txnMatch =
    normalized.match(
      /(?:UPI\s*(?:reference\s*ID|Transaction\s*ID|Ref(?:erence)?\s*(?:No\.?|ID)?)|UTR|Txn\s*ID|Ref\s*No)[:\s]*([0-9]{12})/i
    ) || normalized.match(/\b([0-9]{12})\b/);

  if (txnMatch && txnMatch[1]) {
    upiTxnId = txnMatch[1];
    txnConfidence = 0.95;
  }

  // 5. Intelligent Category Guessing
  let suggestedCategory: ParsedPayment['suggestedCategory'] = 'General';
  const checkText = `${receiverName || ''} ${normalized}`.toLowerCase();

  if (
    checkText.includes('pan center') ||
    checkText.includes('pan shop') ||
    checkText.includes('paan') ||
    checkText.includes('tea') ||
    checkText.includes('chai') ||
    checkText.includes('swiggy') ||
    checkText.includes('zomato') ||
    checkText.includes('cafe') ||
    checkText.includes('coffee') ||
    checkText.includes('restaurant') ||
    checkText.includes('kitchen') ||
    checkText.includes('food') ||
    checkText.includes('pizza') ||
    checkText.includes('burger') ||
    checkText.includes('bakery') ||
    checkText.includes('dhabha') ||
    checkText.includes('bar') ||
    checkText.includes('bites') ||
    checkText.includes('sweets')
  ) {
    suggestedCategory = 'Food';
  } else if (
    checkText.includes('uber') ||
    checkText.includes('ola') ||
    checkText.includes('rapido') ||
    checkText.includes('petrol') ||
    checkText.includes('diesel') ||
    checkText.includes('fuel') ||
    checkText.includes('hpcl') ||
    checkText.includes('bpcl') ||
    checkText.includes('indian oil') ||
    checkText.includes('irctc') ||
    checkText.includes('metro') ||
    checkText.includes('toll') ||
    checkText.includes('flight') ||
    checkText.includes('indigo')
  ) {
    suggestedCategory = 'Fuel';
  } else if (
    checkText.includes('hotel') ||
    checkText.includes('resort') ||
    checkText.includes('stay') ||
    checkText.includes('airbnb') ||
    checkText.includes('hostel') ||
    checkText.includes('room')
  ) {
    suggestedCategory = 'Stay';
  } else if (
    checkText.includes('blinkit') ||
    checkText.includes('zepto') ||
    checkText.includes('instamart') ||
    checkText.includes('dmart') ||
    checkText.includes('grocery') ||
    checkText.includes('supermarket') ||
    checkText.includes('mart')
  ) {
    suggestedCategory = 'Groceries';
  }

  return {
    app,
    amountPaise,
    receiverName,
    receiverVpa,
    upiTxnId,
    suggestedCategory,
    paidAt: new Date().toISOString(),
    confidence: {
      amount: amountConfidence,
      receiver: receiverConfidence,
      txnId: txnConfidence,
      date: 0.5,
    },
    rawText: text,
  };
}
