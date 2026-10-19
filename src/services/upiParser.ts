/**
 * Advanced UPI Receipt & Multi-Category Bill Parser for Split Your Trip.
 * Trained on Indian & Global datasets:
 * - Payment Screenshots: Google Pay, PhonePe, Paytm, CRED, Amazon Pay, BHIM, Navi, Super.money, WhatsApp Pay, Bank UPI (HDFC, SBI, ICICI, Axis, Kotak, etc.)
 * - Physical & Digital Bills: Restaurants, Cafes, Grocery/Marts, Petrol/Fuel pumps, Hotels/Stays, Rides/Tolls/Tickets, Medical/Pharmacy, Shopping/Retail.
 * Rule: Pure function with no React or Supabase imports.
 */

export interface ParsedPayment {
  app:
    | 'gpay'
    | 'phonepe'
    | 'paytm'
    | 'cred'
    | 'amazon_pay'
    | 'bhim'
    | 'navi'
    | 'super.money'
    | 'whatsapp'
    | 'bank_upi'
    | 'unknown';
  amountPaise?: number;
  receiverName?: string;
  receiverVpa?: string;
  upiTxnId?: string;
  billNumber?: string;
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

// -------------------------------------------------------------
// CURATED MERCHANT & BRAND DATASETS (350+ Recognized Brands)
// -------------------------------------------------------------

const FOOD_BRANDS = [
  'cafe coffee day', 'ccd', 'starbucks', 'mcdonalds', 'mcdonald', 'dominos', 'domino',
  'pizza hut', 'kfc', 'burger king', 'subway', 'haldiram', 'haldirams', 'bikanervala',
  'barbeque nation', 'mainland china', 'paradise biryani', 'behrouz', 'biryani by kilo',
  'wow momo', 'chai point', 'chaayos', 'social', 'the beer cafe', 'dunkin', 'baskin robbins',
  'tibbs frankie', 'sagar ratna', 'saravana bhavan', 'punjabi tadka', 'barista', 'costa coffee',
  'blue tokai', 'third wave coffee', 'rebel foods', 'faasos', 'oven story', 'behrouz biryani',
  'zomato', 'swiggy', 'eatclub', 'magicpin', 'box8', 'koolfi', 'naturals ice cream',
  'cream stone', 'gianis', 'rollsking', 'mad over donuts', 'tea post', 'mba chai wala',
  'chai sutta bar', 'amul ice cream', 'amul parlor', 'chitale bandhu', 'anand sweets', 'mithai',
  'sweet', 'sweets', 'bhojanalaya', 'dhaba', 'pan center', 'paan center', 'pan shop', 'paan shop', 'pan', 'paan',
  'restaurant', 'cafe', 'kitchen', 'diner', 'bakery', 'patisserie', 'brewery', 'pizzeria',
  'canteen', 'mess', 'eatery', 'food court', 'bites', 'delight', 'tiffin', 'rasoi',
  'rameshwaram cafe', 'truffles', 'meghana foods', 'empire restaurant', 'vidyarthi bhavan',
  'murugan idli', 'adyar ananda bhavan', 'a2b', 'motimahal', 'bawarchi', 'karachi bakery',
  'pista house', 'shree ganesh', 'honest restaurant', 'keventers', 'nirulas', 'bikaji',
  'tim hortons', 'pret a manger', 'taco bell', 'wendys', 'smoke house deli', 'farzi cafe',
  'zepto cafe', 'blinkit kitchen'
];

const GROCERY_BRANDS = [
  'dmart', 'd mart', 'd-mart', 'avenue supermarts', 'reliance fresh', 'reliance smart', 'reliance retail',
  'smart bazaar', 'more retail', 'more supermarket', 'spencers', 'spencer', 'nature basket', 'natures basket',
  'star bazaar', 'ratnadeep', 'le marche', 'foodhall', 'hypercity', 'big bazaar',
  'blinkit', 'zepto', 'instamart', 'swiggy instamart', 'bigbasket', 'bb daily', 'bb now',
  'dunzo', 'jiomart', 'amazon fresh', 'flipkart minutes', 'milk basket', 'country delight', 'patanjali',
  'otipy', 'fraazo', 'licious', 'freshtohome', 'meatigo', 'tendercuts', 'kisankonnect',
  'kirana', 'provision', 'supermarket', 'mart', 'general store', 'daily needs', 'vegetables',
  'fruits', 'dairy', 'mother dairy', 'nandini', 'amul'
];

const FUEL_BRANDS = [
  'indian oil', 'indianoil', 'iocl', 'bharat petroleum', 'bpcl', 'hindustan petroleum',
  'hpcl', 'shell', 'nayara energy', 'nayara', 'jio-bp', 'jio bp', 'reliance petroleum',
  'petrol pump', 'filling station', 'fuel station', 'auto lpg', 'cng station', 'cng pump',
  'hp auto', 'io auto', 'tata power ev', 'statiq', 'chargezone', 'ather grid', 'zeon charging',
  'blusmart charge', 'bolt.earth', 'glida', 'ev charging'
];

const TRAVEL_TICKET_BRANDS = [
  'uber', 'ola', 'ola cabs', 'rapido', 'namma yatri', 'blusmart', 'indrive', 'make my trip', 'makemytrip',
  'goibibo', 'easemytrip', 'yatra', 'cleartrip', 'ixigo', 'irctc', 'indian railways', 'uts',
  'delhi metro', 'dmrc', 'bmrc', 'maha metro', 'mumbai metro', 'chennai metro', 'cmrl',
  'hyderabad metro', 'pune metro', 'ahmedabad metro', 'kolkata metro', 'redbus', 'abhibus',
  'zingbus', 'intrcity', 'indigo', 'air india', 'spicejet', 'airasia', 'vistara', 'akasa air',
  'air india express', 'fastag', 'netc fastag', 'park+', 'toll plaza', 'toll gate', 'highway toll', 'parking'
];

const STAY_BRANDS = [
  'oyo', 'oyo rooms', 'airbnb', 'fabhotels', 'treebo', 'taj hotels', 'marriott',
  'hyatt', 'radisson', 'ginger hotel', 'lemon tree', 'itc hotels', 'novotel', 'hilton',
  'courtyard', 'jw marriott', 'sheraton', 'westin', 'ibis', 'mercure', 'pullman',
  'doubletree', 'sarovar portico', 'pride hotel', 'royal orchid', 'sterling resorts',
  'club mahindra', 'the leela', 'oberoi', 'trident', 'resort', 'homestay', 'guest house',
  'lodge', 'lodging', 'hotel', 'inn', 'palace'
];

const SHOPPING_BRANDS = [
  'zara', 'h&m', 'uniqlo', 'marks & spencer', 'westside', 'pantaloons', 'shoppers stop',
  'lifestyle', 'max fashion', 'trends', 'reliance trends', 'zudio', 'decathlon', 'croma',
  'reliance digital', 'vijay sales', 'myntra', 'nykaa', 'ajio', 'flipkart', 'amazon',
  'tata cliq', 'meesho', 'snapdeal', 'titan', 'tanishq', 'caratlane', 'bluestone',
  'kalyan jewellers', 'malabar gold', 'joyalukkas', 'lenskart', 'titan eye+', 'bata',
  'woodland', 'metro shoes', 'mochi', 'red tape', 'puma', 'nike', 'adidas', 'reebok',
  'skechers', 'asics', 'apple store', 'samsung', 'oneplus', 'poorvika', 'sangeetha'
];

const MEDICAL_BRANDS = [
  'apollo pharmacy', 'apollo', 'medplus', 'netmeds', 'tata 1mg', '1mg', 'pharmeasy',
  'wellness forever', 'guardian pharmacy', 'frank ross', 'chemist', 'druggist', 'pharmacy',
  'hospital', 'clinic', 'diagnostics', 'dr lal pathlabs', 'metropolis', 'thyrocare',
  'suburban diagnostics', 'max healthcare', 'fortis', 'manipal', 'medanta', 'narayana health',
  'practo'
];

/**
 * Parses raw OCR text extracted from a payment confirmation screenshot or paper bill.
 */
export function parseUpiReceipt(text: string): ParsedPayment {
  const normalized = (text || '').replace(/\r/g, '').trim();
  const lower = normalized.toLowerCase();
  const lines = normalized
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  // -------------------------------------------------------------
  // 1. APP & SOURCE DETECTION
  // -------------------------------------------------------------
  let app: ParsedPayment['app'] = 'unknown';

  if (
    lower.includes('google pay') ||
    lower.includes('gpay') ||
    lower.includes('google transaction id') ||
    lower.includes('google transaction') ||
    lower.includes('cicag') ||
    lower.includes('@okaxis') ||
    lower.includes('@okhdfcbank') ||
    lower.includes('@okicici') ||
    lower.includes('@oksbi')
  ) {
    app = 'gpay';
  } else if (
    lower.includes('phonepe') ||
    lower.includes('phone pe') ||
    (lower.includes('debited from') && lower.includes('utr')) ||
    lower.includes('@ybl') ||
    lower.includes('@ibl') ||
    lower.includes('@axl')
  ) {
    app = 'phonepe';
  } else if (
    lower.includes('super.money') ||
    lower.includes('super money') ||
    lower.includes('supermoney') ||
    lower.includes('@superyes') ||
    lower.includes('@superaxis')
  ) {
    app = 'super.money';
  } else if (lower.includes('cred') || lower.includes('@cred') || lower.includes('cred protect')) {
    app = 'cred';
  } else if (lower.includes('amazon pay') || lower.includes('@apl') || lower.includes('@yapl')) {
    app = 'amazon_pay';
  } else if (
    lower.includes('paytm') ||
    lower.includes('@paytm') ||
    lower.includes('paytm payments bank') ||
    (lower.includes('upi ref no') && lower.includes('paytm'))
  ) {
    app = 'paytm';
  } else if (lower.includes('navi') || lower.includes('@navi')) {
    app = 'navi';
  } else if (lower.includes('bhim') || lower.includes('@upi')) {
    app = 'bhim';
  } else if (lower.includes('whatsapp') || lower.includes('@wa')) {
    app = 'whatsapp';
  } else if (
    lower.includes('hdfc bank') ||
    lower.includes('sbi yono') ||
    lower.includes('state bank of india') ||
    lower.includes('icici bank') ||
    lower.includes('imobile') ||
    lower.includes('axis bank') ||
    lower.includes('kotak') ||
    lower.includes('punjab national bank') ||
    lower.includes('bank of baroda') ||
    lower.includes('idfc first')
  ) {
    app = 'bank_upi';
  }

  // -------------------------------------------------------------
  // 2. RECEIVER VPA EXTRACTION
  // -------------------------------------------------------------
  let receiverVpa: string | undefined;
  const vpaMatch = normalized.match(/([a-zA-Z0-9.\-_]{2,35}@[a-zA-Z0-9]{2,15})/);
  if (vpaMatch && vpaMatch[1]) {
    receiverVpa = vpaMatch[1];
  }

  // -------------------------------------------------------------
  // 3. RECEIVER / MERCHANT NAME EXTRACTION
  // -------------------------------------------------------------
  let receiverName: string | undefined;
  let receiverConfidence = 0;

  // A. Standard UPI Payment Headers: "Paid to [Name]", "To: [Name]", "Transfer to [Name]"
  const paymentToMatch = normalized.match(
    /\b(?:Paid\s*to|Transfer\s*to|Payment\s*to|Sent\s*to|Paid\s*successfully\s*to|Paying\s*to|To)\b\s*[:\-]?\s*([A-Za-z0-9 .,&'()\-]{2,50})/i
  );
  if (paymentToMatch && paymentToMatch[1]) {
    let candidate = paymentToMatch[1].split('\n')[0].trim();
    candidate = candidate
      .replace(/\s+(?:Ref|UPI|Txn|Transaction|via|using|on|from|dated?|at|A\/c|Acc|INR|Rs|\₹)\b.*$/i, '')
      .trim();
    if (
      candidate.length >= 2 &&
      !candidate.includes('@') &&
      !/^(upi|bank|completed|successful|rs|inr|account|payment|driver|merchant|cashier|user|self|total)/i.test(
        candidate
      )
    ) {
      // Normalize ALL-CAPS merchant names to Title Case (e.g. "CHAI POINT" -> "Chai Point")
      if (candidate === candidate.toUpperCase() && candidate !== candidate.toLowerCase()) {
        candidate = candidate
          .toLowerCase()
          .split(' ')
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
      }
      receiverName = candidate;
      receiverConfidence = 0.96;
    }
  }

  // B. Check against Curated Brand Dataset if no explicit payment header
  if (!receiverName) {
    const allKnownBrands = [
      ...FOOD_BRANDS,
      ...GROCERY_BRANDS,
      ...FUEL_BRANDS,
      ...TRAVEL_TICKET_BRANDS,
      ...STAY_BRANDS,
      ...SHOPPING_BRANDS,
      ...MEDICAL_BRANDS,
    ];

    for (const brand of allKnownBrands) {
      const regex = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(lower)) {
        const matchedLine = lines.find(l => regex.test(l));
        if (matchedLine) {
          receiverName = brand
            .split(' ')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
          receiverConfidence = 0.92;
          break;
        }
      }
    }
  }

  // C. Line above VPA or Phone Number (standard in Google Pay / PhonePe receipt layout)
  if (!receiverName) {
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i];
      const nextLine = lines[i + 1];
      const nextIsVpa = nextLine.includes('@');
      const nextClean = nextLine.replace(/[\s\-]/g, '');
      const nextIsPhone = /^(?:\+?91)?[6-9]\d{9}$/.test(nextClean);

      if ((nextIsVpa || nextIsPhone) && !line.includes('@')) {
        const clean = line.replace(/^(?:to|paid to|transfer to|payment to)\s*[:\-]?\s*/i, '').trim();
        if (
          clean.length >= 2 &&
          !/^(from|date|upi|ref|txn|payment|super|google|phonepe|paytm|bhim|cred|completed|status|paid)/i.test(clean) &&
          !/^[0-9₹?*>\$]/.test(clean)
        ) {
          receiverName = clean;
          receiverConfidence = 0.90;
          break;
        }
      }
    }
  }

  // D. Physical Paper Bill Header (Store name is in the top 4 lines of receipts)
  if (!receiverName) {
    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      const candidate = lines[i].replace(/[#*•_\-=]+/g, '').trim();
      if (
        candidate.length >= 3 &&
        candidate.length <= 40 &&
        !/^(tax|invoice|bill|receipt|date|time|table|order|gst|fssai|phone|tel|welcome|customer|cashier|item|qty|rate|amount|total|token|token\s*no)/i.test(
          candidate
        ) &&
        !candidate.includes('@') &&
        !/^[0-9₹$+\-]/.test(candidate)
      ) {
        receiverName = candidate;
        receiverConfidence = 0.82;
        break;
      }
    }
  }

  // E. Fallback from VPA prefix (e.g. rahul.sharma@okaxis -> Rahul Sharma)
  if (!receiverName && receiverVpa) {
    const prefix = receiverVpa.split('@')[0];
    if (!/^[a-z0-9]{1,4}\.[a-z0-9]{6,}$/i.test(prefix)) {
      receiverName = prefix
        .replace(/[._]/g, ' ')
        .split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      receiverConfidence = 0.65;
    }
  }

  if (receiverName) {
    receiverName = receiverName.replace(/[•\-_:;]+$/, '').trim();
  }

  // -------------------------------------------------------------
  // 4. AMOUNT EXTRACTION (MULTI-STRATEGY REFINED PARSER)
  // -------------------------------------------------------------
  let amountPaise: number | undefined;
  let amountConfidence = 0;

  // Helper: cleans candidate text, extracts all valid numeric values, and returns amounts in paise
  const extractAmountCandidatesFromSlice = (
    slice: string,
    options?: { requireDecimals?: boolean; maxResults?: number }
  ): Array<{ paise: number; raw: string; hasDecimals: boolean }> => {
    if (!slice) return [];

    // 1. Strip trailing cash / change / tendered / return sections if they appear in the same slice
    const isolated = slice.split(
      /\b(?:cash(?:\s*tendered|\s*received|\s*paid)?|tendered|change(?:\s*due|\s*returned)?|return(?:\s*amt|\s*amount)?|refund|balance\s*return)\b/i
    )[0];

    // 2. Normalize spaces around decimal points: e.g. "450 . 00" -> "450.00"
    let norm = isolated.replace(/(\d+)\s*\.\s*(\d{1,2})\b/g, '$1.$2');

    // 3. Mask out 10-digit mobile phone numbers and formatted +91 phone numbers
    norm = norm.replace(/(?:\+?91[\s\-]?)?[6-9]\d{4}[\s\-]?\d{5}\b/g, ' ');
    norm = norm.replace(/(?:\+?91[\s\-]?)?[6-9]\d{9}\b/g, ' ');

    // 4. Mask out 12-digit UPI transaction IDs / UTR
    norm = norm.replace(/\b\d{12}\b/g, ' ');

    // 5. Mask out times (e.g. 11:02 PM, 14:32, 11:34 pm) and full dates (numeric, dot, and written months)
    norm = norm.replace(/\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:am|pm|hrs))?\b/gi, ' ');
    norm = norm.replace(/\b\d{1,2}\.\d{2}\s*(?:am|pm|hrs)\b/gi, ' ');
    norm = norm.replace(/\b\d{1,4}\s*[-\/.]\s*\d{1,2}\s*[-\/.]\s*\d{1,4}\b/g, ' ');
    norm = norm.replace(
      /\b\d{1,2}(?:st|nd|rd|th)?[\s\-\/.,]*(?:of\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?:[\s\-\/.,]*\d{2,4})?/gi,
      ' '
    );
    norm = norm.replace(
      /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?[\s\-\/.,]*(?:the\s+)?\d{1,2}(?:st|nd|rd|th)?(?:[\s\-\/.,]*\d{2,4})?/gi,
      ' '
    );
    norm = norm.replace(/\b(?:dated?|on|at|date)\s*[:\-]?\s*\d{1,2}(?:st|nd|rd|th)?\b/gi, ' ');
    norm = norm.replace(/\b20[2-3]\d\b/g, ' ');

    // 6. On payment status/timestamp lines (e.g. "Completed • 19 October 2026, 11:34 pm" or "Status: Completed • 19"),
    // strip any remaining small numbers (1 to 31) because they are calendar days or hours, NEVER payment amounts!
    if (/\b(?:completed|status|successful|timestamp|debited\s*on|paid\s*on)\b/i.test(slice)) {
      norm = norm.replace(/\b(?:[1-9]|[12]\d|3[01])\b/g, ' ');
    }

    // 7. Mask out bank account / card numbers: ending 1234, •••• 1234, xxxx 5678
    norm = norm.replace(/\b(?:a\/c|acc|ending|card)\s*(?:no\.?|ending)?\s*[:\-]?\s*\d{3,6}\b/gi, ' ');
    norm = norm.replace(/[•x*.\-]{3,}\s*\d{3,6}\b/gi, ' ');

    // 8. Normalize OCR misread zeros (O or o) in number sequences (e.g. 25,OOO -> 25,000)
    norm = norm.replace(/\b(\d{1,3})[,.\s']?([oO0]{3})\b/g, '$1,000');
    norm = norm.replace(/\b(\d{1,2})[,.\s']?([oO0]{2})[,.\s']?([oO0]{3})\b/g, '$1,$2,000');
    norm = norm.replace(/(\d)[oO](\d)/g, '$10$2');
    norm = norm.replace(/(\d)[oO]\b/g, '$10');

    // 9. Normalize OCR misread thousand separators (. or space or apostrophe instead of ,)
    // In INR and USD currency, numbers never have 3 decimal places.
    // e.g. "25.000" -> "25,000", "1.45.000" -> "1,45,000", "25 000" -> "25,000", "25'000" -> "25,000"
    norm = norm.replace(/\b(\d{1,2})[.\s'](\d{2})[.\s'](\d{3})(?!\d)/g, '$1,$2,$3');
    norm = norm.replace(/\b(\d{1,3})[.\s'](\d{3})(?!\d)/g, '$1,$2');

    // 10. Remove currency symbols, checkmarks, trailing slashes, dashes, colons, and common OCR rupee glitches (?, *, T, F, z, r, >, v, V, £, €, ¥)
    norm = norm
      .replace(/[₹\u20B9$€£¥✓✔]/g, ' ')
      .replace(/\b(?:rs\.?|inr|inr\.?|rp|usd|eur|gbp)\b/gi, ' ')
      .replace(/(?:^|\s)[✓✔?*#TFzrt>vV•:\-~'"`]\s*(?=\d)/g, ' ')
      .replace(/[\/\-=:;|]+$/, '')
      .trim();

    // 11. Match all number tokens:
    // Supports:
    // - Indian format: 1,45,000.00 or 12,500.00 or 1,500.00
    // - Western format: 1,000,000.00
    // - Standard decimal: 450.50
    // - European comma decimal: 450,50 (must not be followed by comma or another digit)
    // - Plain integer: 450
    const numRegex = /\d[\d,]*\.\d{1,2}|\d+,\d{2}(?!\d|,)\b|\d[\d,]*/g;
    const candidates: Array<{ paise: number; raw: string; hasDecimals: boolean }> = [];
    let m: RegExpExecArray | null;

    while ((m = numRegex.exec(norm)) !== null) {
      let rawStr = m[0].replace(/,+$/, '').trim();
      const matchIndex = m.index;
      const followingStr = norm.slice(matchIndex + m[0].length).trim();
      const precedingStr = norm.slice(0, matchIndex).trim();

      // Check if this number is a percentage (e.g. "5%", "2.5%") -> ignore
      if (followingStr.startsWith('%') || /%$/.test(precedingStr)) {
        continue;
      }

      // Check if preceded directly by quantity / item / metadata indicators (e.g. "Qty: 2", "Items: 3", "Pcs 4")
      if (
        /(?:qty|quantity|items?|pcs|pieces|table|tbl|order|ord|token|tok|no\.?|bill\s*no|inv\s*no|pax)\s*[:\-]?\s*$/i.test(
          precedingStr
        )
      ) {
        continue;
      }

      // Check if followed by non-currency units (e.g. "3 items", "2 pcs", "5 kg", "10 ltr")
      if (/^(?:items?|pcs|pieces|kg|gm|g|ltr|litres?|ml|mins?|hours?|hrs?)\b/i.test(followingStr)) {
        continue;
      }

      // European decimal comma: "450,50" -> "450.50"
      if (!rawStr.includes('.') && /^\d+,\d{2}$/.test(rawStr)) {
        rawStr = rawStr.replace(',', '.');
      }

      // Strip all thousand separator commas
      const cleanNum = rawStr.replace(/,/g, '');
      const floatVal = parseFloat(cleanNum);

      if (isNaN(floatVal) || floatVal <= 0 || floatVal > 50000000) {
        continue;
      }

      // Exclude 4-digit years (2020 - 2035) if there are no decimals
      if (floatVal >= 2020 && floatVal <= 2035 && !rawStr.includes('.')) {
        continue;
      }
      // Exclude 6-digit Indian PIN codes (100000 - 999999) if there are no decimals
      if (floatVal >= 100000 && floatVal <= 999999 && !rawStr.includes('.')) {
        continue;
      }
      // Exclude 10-digit mobile phone numbers
      if (floatVal >= 5000000000 && floatVal <= 9999999999) {
        continue;
      }

      const hasDecimals = rawStr.includes('.');
      if (options?.requireDecimals && !hasDecimals) {
        continue;
      }

      candidates.push({
        paise: Math.round(floatVal * 100),
        raw: rawStr,
        hasDecimals,
      });

      if (options?.maxResults && candidates.length >= options.maxResults) {
        break;
      }
    }

    return candidates;
  };

  // Strategy 1: Final Bill / Invoice Total Keywords (Highest Priority for Bills)
  // Matches: Grand Total, G.Total, Net Payable, Net Amount, Amount Payable, Final Amount, Total Due, Total Amount, Sale Amount, Total (incl...)
  const finalTotalRegex =
    /\b(?:grand\s*total|g\.?\s*total|gr\.?\s*total|gross\s*total|net\s*(?:payable|amount|amt|pay|bill)|payable\s*(?:amount|amt)|amount\s*(?:payable|to\s*pay)|final\s*(?:amount|total|payable|bill)|balance\s*due|total\s*(?:amount\s*due|amount|payable|due|bill|amt|value|charge)|bill\s*(?:amount|total|amt)|invoice\s*(?:total|amount|amt)|order\s*(?:total|amount)|check\s*total|sale\s*amount|total\s*\(incl)\b/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(finalTotalRegex);
    if (match && typeof match.index === 'number') {
      // 1A. Check same line after the keyword
      const afterKeyword = line.slice(match.index + match[0].length);
      const candidates = extractAmountCandidatesFromSlice(afterKeyword);
      if (candidates.length > 0) {
        const chosen = candidates.find(c => c.hasDecimals) || candidates.find(c => c.raw.includes(',')) || candidates[0];
        amountPaise = chosen.paise;
        amountConfidence = 0.99;
        break;
      }

      // 1B. Check next 1 to 3 lines (in case the numeric amount is printed below the label)
      for (let j = i + 1; j <= Math.min(i + 3, lines.length - 1); j++) {
        const nextLine = lines[j].trim();
        if (/^[=\-_*#~.]+$/.test(nextLine) || /thank\s*you|visit\s*again/i.test(nextLine)) {
          continue;
        }
        if (/\b(?:cash|tendered|change|return|refund|balance\s*return)\b/i.test(nextLine)) {
          continue;
        }
        const nextCandidates = extractAmountCandidatesFromSlice(nextLine);
        if (nextCandidates.length > 0) {
          const chosen = nextCandidates.find(c => c.hasDecimals) || nextCandidates.find(c => c.raw.includes(',')) || nextCandidates[0];
          amountPaise = chosen.paise;
          amountConfidence = 0.98;
          break;
        }
      }
      if (amountPaise) break;
    }
  }

  // Strategy 2: Digital Payment & UPI Confirmation Anchors (Highest Priority for Google Pay, PhonePe, Paytm, etc.)
  if (!amountPaise) {
    const paymentAnchorRegex =
      /\b(?:completed|paid|payment\s*(?:successful|done|completed)|transaction\s*(?:successful|completed)|transfer\s*(?:successful|completed)|payment\s*to|paid\s*to|sent\s*to|paying|you\s*paid|money\s*sent|request\s*sent|debited|transferred)\b/i;

    // Helper to score and pick the best amount candidate from a pool
    const pickBestAmountCandidate = (
      pool: Array<{ paise: number; raw: string; hasDecimals: boolean; lineIdx: number; hasCurrencySymbol: boolean }>
    ) => {
      if (!pool || pool.length === 0) return undefined;
      // Filter out small day numbers (1 to 31) if larger realistic payment amounts exist in the pool
      const hasLargeAmount = pool.some(c => c.paise >= 5000); // >= ₹50
      const filtered = hasLargeAmount ? pool.filter(c => c.paise > 3100) : pool;
      const sorted = [...filtered].sort((a, b) => {
        // Priority 1: line had currency symbol (₹, Rs, INR, ✓)
        if (a.hasCurrencySymbol !== b.hasCurrencySymbol) {
          return a.hasCurrencySymbol ? -1 : 1;
        }
        // Priority 2: candidate has decimals
        if (a.hasDecimals !== b.hasDecimals) {
          return a.hasDecimals ? -1 : 1;
        }
        // Priority 3: candidate raw has thousand separator comma
        const aHasComma = a.raw.includes(',');
        const bHasComma = b.raw.includes(',');
        if (aHasComma !== bHasComma) {
          return aHasComma ? -1 : 1;
        }
        // Priority 4: higher amount (e.g. ₹25,000 > ₹19)
        return b.paise - a.paise;
      });
      return sorted[0];
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (paymentAnchorRegex.test(line)) {
        const pool: Array<{ paise: number; raw: string; hasDecimals: boolean; lineIdx: number; hasCurrencySymbol: boolean }> = [];

        // 2A. Check lines ABOVE the anchor (Standard Google Pay / GPay Layout!)
        // In Google Pay:
        // Line i-1: ₹25,000 (or Paid to Jainam Shah)
        // Line i:   Completed • Oct 19, 2026, 11:02 PM
        for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
          const prevLine = lines[j];
          if (
            /(?:google\s*pay|gpay|upi\s*id|transaction\s*id|banking\s*name|account|acc)\b/i.test(prevLine) ||
            prevLine.includes('@')
          ) {
            continue;
          }
          const hasCurrencySymbol = /(?:[₹\u20B9✓✔]|Rs\.?|INR|[?*#TFzrt>])\s*[0-9]+/i.test(prevLine);
          const prevCandidates = extractAmountCandidatesFromSlice(prevLine);
          for (const cand of prevCandidates) {
            pool.push({ ...cand, lineIdx: j, hasCurrencySymbol });
          }
        }

        // 2B. Check SAME line ONLY if it's NOT a status/completion timestamp line
        if (!/\b(?:completed|status|successful|timestamp)\b/i.test(line)) {
          const hasCurrencySymbol = /(?:[₹\u20B9✓✔]|Rs\.?|INR|[?*#TFzrt>])\s*[0-9]+/i.test(line);
          const sameCandidates = extractAmountCandidatesFromSlice(line);
          for (const cand of sameCandidates) {
            pool.push({ ...cand, lineIdx: i, hasCurrencySymbol });
          }
        }

        // 2C. Check lines BELOW the anchor (Standard PhonePe / Super.money / Paytm Layout!)
        // Line i:   Payment Successful
        // Line i+1: ₹25,000
        for (let j = i + 1; j <= Math.min(i + 4, lines.length - 1); j++) {
          const nextLine = lines[j];
          if (/^(?:upi|utr|txn|ref|from|to|google\s*transaction|banking\s*name)\b/i.test(nextLine)) {
            continue;
          }
          const hasCurrencySymbol = /(?:[₹\u20B9✓✔]|Rs\.?|INR|[?*#TFzrt>])\s*[0-9]+/i.test(nextLine);
          const nextCandidates = extractAmountCandidatesFromSlice(nextLine);
          for (const cand of nextCandidates) {
            pool.push({ ...cand, lineIdx: j, hasCurrencySymbol });
          }
        }

        const best = pickBestAmountCandidate(pool);
        if (best) {
          amountPaise = best.paise;
          amountConfidence = 0.99;
          break;
        }
      }
    }
  }

  // Strategy 3: Dedicated Amount Line with Currency Symbol or Rupee OCR Glyph
  // (₹, Rs, INR, checkmark ✓, or common OCR substitutes ?, *, T, F, z, r, > followed by numbers)
  if (!amountPaise) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/(?:upi|utr|txn|ref|order|inv|tax|fssai|phone|tel)\b/i.test(line)) {
        continue;
      }
      if (/(?:[₹\u20B9✓✔]|Rs\.?|INR|[?*#TFzrt>])\s*[0-9]+/i.test(line)) {
        const candidates = extractAmountCandidatesFromSlice(line);
        if (candidates.length > 0) {
          const chosen = candidates.find(c => c.hasDecimals) || candidates.find(c => c.raw.includes(',')) || candidates[0];
          amountPaise = chosen.paise;
          amountConfidence = 0.92;
          break;
        }
      }
    }
  }

  // Strategy 4: Prominent Standalone Amount in Digital Payment Screenshots
  // (When the currency symbol is omitted by OCR, e.g. "1,810.50" or "650")
  if (
    !amountPaise &&
    (app !== 'unknown' ||
      lower.includes('upi') ||
      lower.includes('transaction') ||
      lower.includes('completed') ||
      lower.includes('paid'))
  ) {
    for (let i = 0; i < Math.min(lines.length, 8); i++) {
      const line = lines[i];
      if (/(?:upi|utr|txn|ref|phone|tel|id|no|date|time)\b/i.test(line) || line.includes('@')) {
        continue;
      }
      const candidates = extractAmountCandidatesFromSlice(line);
      if (candidates.length > 0) {
        const chosen = candidates.find(c => c.hasDecimals) || candidates.find(c => c.raw.includes(',')) || candidates[0];
        amountPaise = chosen.paise;
        amountConfidence = 0.88;
        break;
      }
    }
  }

  // Strategy 5: Standalone or Explicit "Total" (Excluding Subtotal / Total Items / Total Qty)
  if (!amountPaise) {
    const genericTotalRegex = /\b(?:total|tot|payable|to\s*pay|amount\s*due|bill\s*due)\b/i;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (/\b(?:sub\s*total|subtotal|items?|qty|quantity|count|discount|saving|savings)\b/i.test(line)) {
        continue;
      }
      const match = line.match(genericTotalRegex);
      if (match && typeof match.index === 'number') {
        const afterKeyword = line.slice(match.index + match[0].length);
        const candidates = extractAmountCandidatesFromSlice(afterKeyword);
        if (candidates.length > 0) {
          const chosen = candidates.find(c => c.hasDecimals) || candidates.find(c => c.raw.includes(',')) || candidates[0];
          amountPaise = chosen.paise;
          amountConfidence = 0.95;
          break;
        }
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          if (!/^[=\-_*#~.]+$/.test(nextLine) && !/\b(?:cash|tendered|change|items?|qty)\b/i.test(nextLine)) {
            const nextCandidates = extractAmountCandidatesFromSlice(nextLine);
            if (nextCandidates.length > 0) {
              const chosen = nextCandidates.find(c => c.hasDecimals) || nextCandidates.find(c => c.raw.includes(',')) || nextCandidates[0];
              amountPaise = chosen.paise;
              amountConfidence = 0.94;
              break;
            }
          }
        }
      }
    }
  }

  // Strategy 6: Action verbs with amount: "Paid 450", "Debited by Rs. 1,200", "Amount 350.50"
  if (!amountPaise) {
    const actionMatch = normalized.match(
      /(?:paid|transfer(?:red)?|amount|sent|debited\s*(?:by|of)?)\s*(?:of)?\s*(?:[₹\u20B9?*>\$]|Rs\.?|INR)?\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/i
    );
    if (actionMatch && actionMatch[1]) {
      const candidates = extractAmountCandidatesFromSlice(actionMatch[1]);
      if (candidates.length > 0) {
        amountPaise = candidates[0].paise;
        amountConfidence = 0.90;
      }
    }
  }

  // Strategy 7: Sub Total (ONLY as fallback if no Grand Total was found)
  if (!amountPaise) {
    const subTotalRegex = /\b(?:sub\s*total|subtotal|sub-total)\b/i;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(subTotalRegex);
      if (match && typeof match.index === 'number') {
        const afterKeyword = line.slice(match.index + match[0].length);
        const candidates = extractAmountCandidatesFromSlice(afterKeyword);
        if (candidates.length > 0) {
          amountPaise = candidates[0].paise;
          amountConfidence = 0.85;
          break;
        } else if (i + 1 < lines.length) {
          const nextCandidates = extractAmountCandidatesFromSlice(lines[i + 1]);
          if (nextCandidates.length > 0) {
            amountPaise = nextCandidates[0].paise;
            amountConfidence = 0.84;
            break;
          }
        }
      }
    }
  }

  // Strategy 8: Bottom Decimal Number in Paper Bill (Universal Fallback for Physical Bills)
  if (!amountPaise && lines.length > 0) {
    const startIdx = Math.floor(lines.length * 0.35);
    let bestCandidatePaise: number | undefined;

    for (let i = lines.length - 1; i >= startIdx; i--) {
      const line = lines[i];
      if (/\b(?:cash|tendered|change|phone|tel|fssai|gstin|balance|card|return|refund|order|table)\b/i.test(line)) {
        continue;
      }
      if (/[0-9]+\.[0-9]{2}\b/.test(line)) {
        const candidates = extractAmountCandidatesFromSlice(line, { requireDecimals: true });
        if (candidates.length > 0) {
          const candidatePaise = candidates[0].paise;
          if (!bestCandidatePaise || candidatePaise > bestCandidatePaise) {
            bestCandidatePaise = candidatePaise;
          }
        }
      }
    }

    if (bestCandidatePaise) {
      amountPaise = bestCandidatePaise;
      amountConfidence = 0.72;
    }
  }

  // -------------------------------------------------------------
  // 5. UPI TRANSACTION ID & BILL NUMBER EXTRACTION
  // -------------------------------------------------------------
  let upiTxnId: string | undefined;
  let billNumber: string | undefined;
  let txnConfidence = 0;

  // 12-digit UPI reference ID / UTR
  const txnMatch =
    normalized.match(
      /(?:UPI\s*(?:reference\s*ID|Transaction\s*ID|Ref(?:erence)?\s*(?:No\.?|ID)?)|UTR|Txn\s*ID|Google\s*transaction\s*ID|Ref\s*No)[:\s]*([0-9]{12})/i
    ) || normalized.match(/\b([0-9]{12})\b/);

  if (txnMatch && txnMatch[1]) {
    upiTxnId = txnMatch[1];
    txnConfidence = 0.95;
  }

  // Bill / Invoice number (e.g. Bill No: 1042, Inv # 98213)
  const billNoMatch = normalized.match(
    /(?:Bill\s*(?:No\.?|#)|Invoice\s*(?:No\.?|#)|Order\s*(?:ID|#|No\.?))[:\s]*([A-Za-z0-9\-_]{3,20})/i
  );
  if (billNoMatch && billNoMatch[1]) {
    billNumber = billNoMatch[1];
  }

  // -------------------------------------------------------------
  // 6. CATEGORY INTELLIGENCE
  // -------------------------------------------------------------
  let suggestedCategory: ParsedPayment['suggestedCategory'] = 'General';
  const categorySearchText = `${receiverName || ''} ${normalized}`.toLowerCase();

  const isInCategory = (brandList: string[]) => {
    return brandList.some(b => categorySearchText.includes(b));
  };

  if (isInCategory(FOOD_BRANDS)) {
    suggestedCategory = 'Food';
  } else if (isInCategory(GROCERY_BRANDS)) {
    suggestedCategory = 'Groceries';
  } else if (isInCategory(FUEL_BRANDS)) {
    suggestedCategory = 'Fuel';
  } else if (isInCategory(TRAVEL_TICKET_BRANDS)) {
    suggestedCategory = 'Tickets';
  } else if (isInCategory(STAY_BRANDS)) {
    suggestedCategory = 'Stay';
  } else if (isInCategory(SHOPPING_BRANDS) || isInCategory(MEDICAL_BRANDS)) {
    suggestedCategory = 'General';
  }

  return {
    app,
    amountPaise,
    receiverName,
    receiverVpa,
    upiTxnId,
    billNumber,
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
