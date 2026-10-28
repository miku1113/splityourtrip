import { Trip, TripMember } from '../types/database';

export const normalizePhone = (phone?: string | null): string => {
  if (!phone) return '';
  return phone.replace(/\D/g, '').slice(-10);
};

export interface ParsedVoiceExpense {
  rawTranscript: string;
  matchedTrip: Trip | null;
  amountRupees: string;
  amountPaise: number;
  description: string;
  category: string;
  paidByMemberId: string | null;
  paidByMemberName: string | null;
  splitAll: boolean;
  selectedParticipantIds: string[];
  matchedParticipantNames: string[];
  unmatchedNames: string[];
  confidence: number;
  paymentMode: 'upi' | 'cash' | 'other';
}

const DEVANAGARI_DIGITS: Record<string, string> = {
  // Devanagari numerals
  '\u0966': '0', '\u0967': '1', '\u0968': '2', '\u0969': '3', '\u096A': '4',
  '\u096B': '5', '\u096C': '6', '\u096D': '7', '\u096E': '8', '\u096F': '9',
  // Gujarati numerals
  '\u0AE6': '0', '\u0AE7': '1', '\u0AE8': '2', '\u0AE9': '3', '\u0AEA': '4',
  '\u0AEB': '5', '\u0AEC': '6', '\u0AED': '7', '\u0AEE': '8', '\u0AEF': '9',
};

export function normalizeDigits(str: string): string {
  return str.replace(/[०-९૦-૯]/g, d => DEVANAGARI_DIGITS[d] || d);
}

const SPECIFIC_CATEGORIES: Record<string, string[]> = {
  Food: [
    'food', 'dinner', 'lunch', 'breakfast', 'snack', 'snacks', 'coffee', 'tea', 'cafe',
    'restaurant', 'drinks', 'drink', 'beer', 'alcohol', 'bar', 'pub', 'club', 'wine',
    'burger', 'pizza', 'meal', 'zomato', 'swiggy', 'ice cream', 'dessert', 'dhaba',
    'khana', 'bhojan', 'chai', 'cha', 'nashta', 'nasto', 'jamvanu', 'mithai', 'dawat',
    'biryani', 'roti', 'rotli', 'sabzi', 'shak', 'shaak', 'thali', 'samosa', 'vadapav',
    'dosa', 'pav bhaji', 'momos', 'maggi', 'bakery', 'cake', 'pastry', 'cold drink',
    'juice', 'bisleri', 'water bottle', 'eatclub', 'magicpin',
    // Hindi Devanagari
    'खाना', 'भोजन', 'चाय', 'नाश्ता', 'कॉफी', 'डिनर', 'लंच', 'पानी', 'समोसा', 'रोटी',
    // Gujarati script
    'જમવાનું', 'ખાવાનું', 'ચા', 'નાસ્તો', 'કોફી', 'દિન્નર', 'લંચ', 'શાક', 'રોટલી',
  ],
  Stay: [
    'hotel', 'stay', 'room', 'resort', 'airbnb', 'hostel', 'villa', 'lodge', 'accommodation',
    'booking', 'checkout', 'check in', 'check out', 'kamra', 'kamro', 'rokan', 'dharamshala',
    'oyo', 'homestay', 'cottage', 'tent', 'camping', 'zostel', 'gostops', 'dorm',
    // Hindi & Gujarati
    'होटल', 'कमरा', 'रूम', 'रिसोर्ट', 'હોટલ', 'રૂમ', 'રિસોર્ટ', 'રોકાણ',
  ],
  Fuel: [
    'fuel', 'petrol', 'diesel', 'cng', 'gas', 'toll', 'toll tax', 'parking', 'fastag',
    'pump', 'petrol pump', 'gaadi', 'gadi', 'car wash', 'puncture', 'air',
    // Hindi & Gujarati
    'पेट्रोल', 'डीजल', 'टोल', 'गाड़ी', 'पंप', 'પેટ્રોલ', 'ડીઝલ', 'ટોલ', 'ગાડી',
  ],
  Tickets: [
    'ticket', 'tickets', 'flight', 'train', 'bus', 'metro', 'entry', 'entry fee', 'monument',
    'show', 'movie', 'cinema', 'pvr', 'inox', 'pass', 'safari', 'museum', 'ferry', 'cruise',
    'boat', 'shikara', 'cab', 'taxi', 'uber', 'ola', 'rapido', 'indrive', 'auto', 'rickshaw',
    'riksha', 'tuk tuk', 'bhada', 'bhadu', 'kiraya', 'waterpark', 'amusement park',
    'trekking', 'rafting', 'scuba', 'parasailing',
    // Hindi & Gujarati
    'टिकट', 'ट्रेन', 'फ्लाइट', 'बस', 'टैक्सी', 'ऑटो', 'किराया', 'भाड़ा', 'સિનેમા', 'ટિકિટ', 'ટ્રેન', 'ફ્લાઇટ', 'બસ', 'ભાડું',
  ],
  Groceries: [
    'groceries', 'grocery', 'supermarket', 'mart', 'kirana', 'vegetables', 'fruits', 'milk',
    'water', 'provisions', 'ration', 'dmart', 'blinkit', 'zepto', 'instamart', 'bigbasket',
    'doodh', 'dudh', 'shaak', 'shak', 'kariyana', 'paneer', 'dahi', 'curd', 'bread', 'butter',
    'दूध', 'फल', 'सब्जी', 'કિરાણા', 'દૂધ', 'ફળ', 'શાકભાજી',
  ],
  Entertainment: [
    'entertainment', 'bowling', 'arcade', 'gaming', 'snooker', 'pool', 'turf', 'cricket',
    'concert', 'live show', 'event', 'clubbing', 'party', 'activity', 'activities',
    'पार्टी', 'મનોરંજન', 'પાર્ટી',
  ],
  Shopping: [
    'shopping', 'gift', 'gifts', 'souvenir', 'souvenirs', 'clothes', 'dress', 'tshirt',
    'footwear', 'sunglasses', 'bazaar', 'market', 'handicrafts',
    'कपड़े', 'खरीदारी', 'શોપિંગ', 'કપડાં',
  ],
  Medical: [
    'medical', 'medicine', 'medicines', 'pharmacy', 'chemist', 'doctor', 'clinic',
    'hospital', 'first aid', 'tablet', 'syrup', 'bandage',
    'दवा', 'दवाई', 'ડોક્ટર', 'દવાઓ',
  ],
};

const GENERAL_KEYWORDS = [
  'shopping', 'gift', 'souvenir', 'clothes', 'tip', 'medical', 'medicine', 'misc', 'general',
  'bill', 'expense', 'kharch', 'kharcha', 'hisab', 'payment', 'charge', 'chukaavani',
  'खर्च', 'खर्चा', 'बिल', 'પેમેન્ટ', 'ખર્ચ', 'બિલ',
];

const NUMBER_WORDS: Record<string, number> = {
  // English
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, hundred: 100, thousand: 1000, lakh: 100000, crore: 10000000,

  // Hindi & Hinglish
  ek: 1, do: 2, teen: 3, chaar: 4, char: 4, paanch: 5, panch: 5, chhe: 6, che: 6, saat: 7, aath: 8,
  ath: 8, nau: 9, nav: 9, das: 10, dus: 10, gyarah: 11, barah: 12, terah: 13, chaudah: 14, pandrah: 15,
  solah: 16, satrah: 17, atharah: 18, unnis: 19, bees: 20, bis: 20, ikkis: 21, baais: 22, teis: 23,
  chaubis: 24, pachis: 25, pacchis: 25, chhabis: 26, sattais: 27, atthais: 28, untees: 29, tees: 30,
  chaalis: 40, chalis: 40, pachaas: 50, pachas: 50, saath: 60, sath: 60, sattar: 70, assi: 80,
  nabbe: 90, sau: 100, so: 100, hazar: 1000, hazaar: 1000,

  // Gujarati
  be: 2, tran: 3, chha: 6, sat: 7, agiyar: 11, bar: 12, ter: 13, chaud: 14, pandar: 15, sol: 16,
  vees: 20, vis: 20, trees: 30, tris: 30, hajar: 1000,
};

/**
 * Normalizes text while preserving Unicode letters, marks, and numbers
 */
export function cleanText(str: string): string {
  const norm = normalizeDigits(str || '');
  return norm
    .replace(/(\d),(\d)/g, '$1$2')
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts numeric amount in rupees from spoken text (digits, currency symbols, and multilingual phrases)
 */
export function parseSpokenAmount(text: string): { amountRupees: string; amountPaise: number } {
  const norm = normalizeDigits(text || '');
  // Clean commas in numbers like 1,500 -> 1500
  const clean = norm.replace(/(\d),(\d)/g, '$1$2');

  // 1. Currency patterns with numbers (e.g. ₹500, 500 rupees, 500 rupaye, 500 rupiya, 500 रुपये, 500 રૂપિયા)
  const currencyPatterns = [
    /(?:(?:rs\.?|rupees|rupaye|rupiya|rupya|inr|₹|bucks|रुपये|रुपया|रुपए|रु|રૂપિયા|રૂપિયાનું|રૂપિયો|રુપિયા)\s*)(\d+(?:\.\d{1,2})?)/i,
    /(\d+(?:\.\d{1,2})?)\s*(?:rs\.?|rupees|rupaye|rupiya|rupya|inr|₹|bucks|\/-|रुपये|रुपया|रुपए|रु|રૂપિયા|રૂપિયાનું|રૂપિયો|રુપિયા)/i,
    /(?:of|for|amount|worth|cost|kharch|kharcha|bhav|nu|no|ka|ki|ke|का|की|के|નું|નો)\s*(?:rs\.?|rupees|rupaye|rupiya|inr|₹|रुपये|રૂપિયા)?\s*(\d+(?:\.\d{1,2})?)/i,
  ];

  for (const pattern of currencyPatterns) {
    const match = clean.match(pattern);
    if (match && match[1]) {
      const num = parseFloat(match[1]);
      if (!isNaN(num) && num > 0) {
        return {
          amountRupees: match[1],
          amountPaise: Math.round(num * 100),
        };
      }
    }
  }

  // 2. Abbreviated numbers (e.g. 1.5k, 2k)
  const kMatch = clean.match(/\b(\d+(?:\.\d{1,2})?)\s*k\b/i);
  if (kMatch && kMatch[1]) {
    const kNum = parseFloat(kMatch[1]) * 1000;
    if (!isNaN(kNum) && kNum > 0) {
      return {
        amountRupees: kNum.toString(),
        amountPaise: Math.round(kNum * 100),
      };
    }
  }

  // 3. Indian colloquial compound phrases (dedh sau = 150, dhai sau = 250, etc.)
  const cleanLower = clean.toLowerCase();
  if (/\b(?:sawa|sava)\s+(?:sau|so|hundred)\b/.test(cleanLower)) {
    return { amountRupees: '125', amountPaise: 12500 };
  }
  if (/\b(?:dedh|dodh)\s+(?:sau|so|hundred)\b/.test(cleanLower)) {
    return { amountRupees: '150', amountPaise: 15000 };
  }
  if (/\b(?:dhai|adi)\s+(?:sau|so|hundred)\b/.test(cleanLower)) {
    return { amountRupees: '250', amountPaise: 25000 };
  }
  if (/\b(?:dedh|dodh)\s+(?:hazar|hazaar|hajar|thousand)\b/.test(cleanLower)) {
    return { amountRupees: '1500', amountPaise: 150000 };
  }
  if (/\b(?:dhai|adi)\s+(?:hazar|hazaar|hajar|thousand)\b/.test(cleanLower)) {
    return { amountRupees: '2500', amountPaise: 250000 };
  }

  // 4. Standalone digits (e.g. "Dinner 500", "500 Petrol", "Cafe 250", "Chai 40")
  const allNumberMatches = Array.from(clean.matchAll(/\b(\d+(?:\.\d{1,2})?)\b/g));
  if (allNumberMatches.length > 0) {
    // Filter out obvious years (2024 to 2035) unless it is the only number
    const nonYearMatch = allNumberMatches.find(m => {
      const n = parseFloat(m[1]);
      return n > 0 && (n < 2020 || n > 2035);
    });

    const chosenMatch = nonYearMatch || allNumberMatches[0];
    if (chosenMatch && chosenMatch[1]) {
      const num = parseFloat(chosenMatch[1]);
      if (!isNaN(num) && num > 0) {
        return {
          amountRupees: chosenMatch[1],
          amountPaise: Math.round(num * 100),
        };
      }
    }
  }

  // 5. Spoken words from NUMBER_WORDS
  const words = cleanLower.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (NUMBER_WORDS[w] !== undefined) {
      let val = NUMBER_WORDS[w];
      const next = words[i + 1];

      if (next && (next === 'sau' || next === 'so' || next === 'hundred')) {
        val = val * 100;
        const nextNext = words[i + 2];
        if (nextNext && NUMBER_WORDS[nextNext] !== undefined) {
          val = val + NUMBER_WORDS[nextNext];
        }
      } else if (next && (next === 'hazar' || next === 'hazaar' || next === 'hajar' || next === 'thousand')) {
        val = val * 1000;
        const nextNext = words[i + 2];
        if (nextNext && (nextNext === 'sau' || nextNext === 'so' || nextNext === 'hundred') && words[i + 3]) {
          const numHundred = NUMBER_WORDS[words[i + 3]];
          if (numHundred) val += numHundred * 100;
        } else if (nextNext && NUMBER_WORDS[nextNext] !== undefined) {
          val = val + NUMBER_WORDS[nextNext];
        }
      }

      if (val > 0) {
        return {
          amountRupees: val.toString(),
          amountPaise: Math.round(val * 100),
        };
      }
    }
  }

  return { amountRupees: '', amountPaise: 0 };
}

/**
 * Parses spoken voice text in English, Hindi, Gujarati, or Hinglish
 * and extracts expense details matching active trips and members.
 */
export function parseVoiceExpense(
  transcript: string,
  trips: Trip[],
  currentUserId?: string,
  currentUserPhone?: string | null,
  tripMembersMap?: Record<string, TripMember[]>
): ParsedVoiceExpense {
  const clean = cleanText(transcript);
  const cleanLower = clean.toLowerCase();

  // 1. MATCH TRIP
  let matchedTrip: Trip | null = null;
  let highestTripScore = 0;

  for (const t of trips) {
    if (!t || !t.name) continue;
    const tClean = cleanText(t.name).toLowerCase();
    const tWords = tClean.split(' ').filter(w => w.length >= 3);

    // Direct match
    if (cleanLower.includes(tClean)) {
      matchedTrip = t;
      highestTripScore = 100;
      break;
    }

    // Word match
    for (const w of tWords) {
      if (cleanLower.includes(w) && w.length > highestTripScore) {
        matchedTrip = t;
        highestTripScore = w.length;
      }
    }
  }

  if (!matchedTrip && trips.length > 0) {
    matchedTrip = trips[0];
  }

  // Fetch members of the matched trip
  const tripMembers: TripMember[] =
    matchedTrip && tripMembersMap ? tripMembersMap[matchedTrip.id] || [] : [];

  const currentMember =
    tripMembers.find(m => {
      if (currentUserId && (m.profile_id === currentUserId || m.user_id === currentUserId)) return true;
      if (currentUserPhone && m.phone_number && normalizePhone(currentUserPhone) === normalizePhone(m.phone_number))
        return true;
      const nameLower = m.display_name.toLowerCase();
      return nameLower === 'you' || nameLower.endsWith('(you)');
    }) ||
    tripMembers[0] ||
    null;

  // 2. MATCH AMOUNT
  const { amountRupees, amountPaise } = parseSpokenAmount(transcript);

  // 3. MATCH PAYER ("paid by me", "maine pay kiya", "me apya", "मैंने दिया", "મેં ચૂકવ્યા")
  let paidByMemberId: string | null = currentMember ? currentMember.id : null;
  let paidByMemberName: string | null = currentMember ? 'You' : null;

  const isPaidByMe =
    // English
    cleanLower.includes('paid by me') ||
    cleanLower.includes('i paid') ||
    cleanLower.includes('paid by myself') ||
    cleanLower.includes('my bill') ||
    cleanLower.includes('by me') ||
    cleanLower.includes('my treat') ||
    cleanLower.includes('spent by me') ||
    cleanLower.includes('on my upi') ||
    // Hindi & Hinglish
    cleanLower.includes('maine pay kiya') ||
    cleanLower.includes('maine diya') ||
    cleanLower.includes('maine bhara') ||
    cleanLower.includes('mene diya') ||
    cleanLower.includes('humne diya') ||
    cleanLower.includes('humne pay kiya') ||
    cleanLower.includes('mera kharcha') ||
    clean.includes('मैंने दिया') ||
    clean.includes('मैंने पे किया') ||
    clean.includes('मैंने भरा') ||
    clean.includes('मेरी तरफ से') ||
    // Gujarati
    cleanLower.includes('me chukvya') ||
    cleanLower.includes('me apya') ||
    cleanLower.includes('me pay karyu') ||
    cleanLower.includes('me kharch karyo') ||
    clean.includes('મેં ચૂકવ્યા') ||
    clean.includes('મેં આપ્યા') ||
    clean.includes('મેં પે કર્યું') ||
    clean.includes('મારા તરફથી');

  if (isPaidByMe) {
    if (currentMember) {
      paidByMemberId = currentMember.id;
      paidByMemberName = 'You';
    }
  } else {
    // Check if another member is named as payer
    let matchedOtherPayer: TripMember | null = null;
    for (const m of tripMembers) {
      const mClean = cleanText(m.display_name).toLowerCase().replace(/\s*\(you\)\s*/, '');
      if (mClean.length < 2) continue;
      if (
        cleanLower.includes(`paid by ${mClean}`) ||
        cleanLower.includes(`${mClean} ne pay kiya`) ||
        cleanLower.includes(`${mClean} ne diya`) ||
        cleanLower.includes(`${mClean} e apya`) ||
        cleanLower.includes(`${mClean} e pay karyu`) ||
        clean.includes(`${mClean} ने दिया`) ||
        clean.includes(`${mClean} એ આપ્યા`)
      ) {
        matchedOtherPayer = m;
        break;
      }
    }

    if (matchedOtherPayer) {
      paidByMemberId = matchedOtherPayer.id;
      paidByMemberName = matchedOtherPayer.display_name;
    }
  }

  // 4. MATCH SPLIT PARTICIPANTS
  const isSplitAll =
    cleanLower.includes('all the members') ||
    cleanLower.includes('all members') ||
    cleanLower.includes('everyone') ||
    cleanLower.includes('split with all') ||
    cleanLower.includes('split all') ||
    cleanLower.includes('equally') ||
    cleanLower.includes('among all') ||
    cleanLower.includes('sab members') ||
    cleanLower.includes('sabhi members') ||
    cleanLower.includes('sab log') ||
    cleanLower.includes('sabme baant do') ||
    cleanLower.includes('sab me') ||
    cleanLower.includes('badha member') ||
    cleanLower.includes('badha ma') ||
    cleanLower.includes('badha vache') ||
    clean.includes('सब में') ||
    clean.includes('सभी में') ||
    clean.includes('सब लोग') ||
    clean.includes('બધા માં') ||
    clean.includes('બધા વચ્ચે');

  let splitAll = isSplitAll;
  const selectedParticipantIds: string[] = [];
  const matchedParticipantNames: string[] = [];

  if (isSplitAll || tripMembers.length === 0) {
    splitAll = true;
    tripMembers.forEach(m => {
      selectedParticipantIds.push(m.id);
      matchedParticipantNames.push(m.display_name);
    });
  } else {
    // Check specific member names
    for (const m of tripMembers) {
      const mNormalized = cleanText(m.display_name).toLowerCase().replace(/\s*\(you\)\s*/, '');
      const firstName = mNormalized.split(' ')[0];
      if (firstName.length >= 3 && cleanLower.includes(firstName)) {
        if (!selectedParticipantIds.includes(m.id)) {
          selectedParticipantIds.push(m.id);
          matchedParticipantNames.push(m.display_name);
        }
      }
    }

    if (currentMember && !selectedParticipantIds.includes(currentMember.id)) {
      selectedParticipantIds.unshift(currentMember.id);
      matchedParticipantNames.unshift(currentMember.display_name);
    }

    if (selectedParticipantIds.length <= 1) {
      splitAll = true;
      selectedParticipantIds.length = 0;
      matchedParticipantNames.length = 0;
      tripMembers.forEach(m => {
        selectedParticipantIds.push(m.id);
        matchedParticipantNames.push(m.display_name);
      });
    }
  }

  // 5. MATCH CATEGORY & DESCRIPTION
  let category = 'General';
  let description = '';

  let matchedSpecificCategory = false;
  for (const [catName, keywords] of Object.entries(SPECIFIC_CATEGORIES)) {
    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      if (cleanLower.includes(kwLower) || clean.includes(kw)) {
        category = catName;
        matchedSpecificCategory = true;
        if (!description) {
          description = kw.charAt(0).toUpperCase() + kw.slice(1);
        }
        break;
      }
    }
    if (matchedSpecificCategory) break;
  }

  if (!matchedSpecificCategory) {
    for (const kw of GENERAL_KEYWORDS) {
      if (cleanLower.includes(kw.toLowerCase()) || clean.includes(kw)) {
        category = 'General';
        break;
      }
    }
  }

  if (!description) {
    if (matchedTrip) {
      description = `${matchedTrip.name} Expense`;
    } else {
      description = 'Voice Expense';
    }
  }

  let confidence = 50;
  if (matchedTrip) confidence += 20;
  if (amountPaise > 0) confidence += 20;
  if (selectedParticipantIds.length > 0) confidence += 10;

  // Match Payment Mode
  let paymentMode: 'upi' | 'cash' | 'other' = 'upi';
  if (/\b(?:cash|rokhda|nagad|cash\s*(?:me|ma|se))\b/i.test(cleanLower)) {
    paymentMode = 'cash';
  } else if (/\b(?:card|credit|debit|net\s*banking|bank\s*transfer)\b/i.test(cleanLower)) {
    paymentMode = 'other';
  } else if (/\b(?:upi|gpay|google\s*pay|phonepe|paytm|bhim|qr|online)\b/i.test(cleanLower)) {
    paymentMode = 'upi';
  }

  return {
    rawTranscript: transcript,
    matchedTrip,
    amountRupees,
    amountPaise,
    description,
    category,
    paidByMemberId,
    paidByMemberName,
    splitAll,
    selectedParticipantIds,
    matchedParticipantNames,
    unmatchedNames: [],
    confidence,
    paymentMode,
  };
}

export interface VoiceExpenseAnalysis {
  isValid: boolean;
  status: 'valid' | 'no_amount' | 'no_expense_intent' | 'empty';
  errorMessage?: string;
  suggestion?: string;
  parsed: ParsedVoiceExpense;
}

/**
 * Validates and analyzes spoken expense text.
 */
export function analyzeVoiceExpense(
  transcript: string,
  trips: Trip[],
  currentUserId?: string,
  currentUserPhone?: string | null,
  tripMembersMap?: Record<string, TripMember[]>
): VoiceExpenseAnalysis {
  const clean = (transcript || '').trim();
  if (!clean) {
    return {
      isValid: false,
      status: 'empty',
      errorMessage: 'No speech detected yet.',
      suggestion: 'Speak your expense, e.g. "Dinner ₹500 in Goa trip"',
      parsed: parseVoiceExpense('', trips, currentUserId, currentUserPhone, tripMembersMap),
    };
  }

  const parsed = parseVoiceExpense(clean, trips, currentUserId, currentUserPhone, tripMembersMap);

  if (!parsed.amountPaise || parsed.amountPaise <= 0) {
    const isGreeting =
      /^(hello|hi|hey|good\s+morning|good\s+evening|kem\s+cho|namaste|kaise\s+ho|what\s+is|who\s+are)\b/i.test(
        clean
      );
    return {
      isValid: false,
      status: isGreeting ? 'no_expense_intent' : 'no_amount',
      errorMessage: isGreeting
        ? 'This sounds like conversation, not a travel expense.'
        : `Couldn't detect an expense amount in: "${clean.slice(0, 50)}${clean.length > 50 ? '...' : ''}"`,
      suggestion: 'Please include the amount (e.g., "₹120 for coffee" or "Petrol 500 rupaye").',
      parsed,
    };
  }

  return {
    isValid: true,
    status: 'valid',
    parsed,
  };
}
