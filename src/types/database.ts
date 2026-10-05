export type TripRole = 'admin' | 'member';
export type MemberStatus = 'invited' | 'accepted' | 'declined';
export type PaymentMode = 'upi' | 'cash' | 'other';
export type SplitType = 'equal' | 'exact' | 'custom' | 'percentage' | 'shares';

export interface Profile {
  id: string;
  full_name: string | null;
  name?: string | null; // UI helper alias
  avatar_url: string | null;
  phone_number?: string | null;
  currency?: string | null;
  country?: string | null;
  upi_id?: string | null;
  push_token?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Trip {
  id: string;
  name: string;
  description?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  currency?: string;
  status?: 'active' | 'settled' | 'archived';
  trip_type?: 'group' | 'friend_split';
  friend_id?: string;
  image_url?: string | null;
  invite_code?: string;
  created_by: string;
  created_at: string;
  updated_at?: string;
}

export interface TripMember {
  id: string;
  trip_id: string;
  profile_id?: string;
  user_id?: string | null; // UI helper alias for profile_id
  display_name: string;
  phone_number?: string | null;
  role: TripRole;
  status?: MemberStatus;
  is_guest?: boolean;
  joined_at?: string;
  created_at?: string;
}

export interface Invite {
  id: string;
  trip_id: string;
  code: string;
  invited_by: string;
  expires_at: string | null;
  max_uses: number | null;
  created_at: string;
}

export interface Expense {
  id: string;
  trip_id: string;
  paid_by: string; // profile_id or member_id
  amount: number; // in paise
  description: string;
  category: string;
  payment_mode?: PaymentMode;
  upi_txn_id?: string | null;
  screenshot_path?: string | null;
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_type?: 'image' | 'pdf' | 'doc' | null;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  split_type?: SplitType;
  currency?: string;
  date?: string;
  expense_date?: string;
  created_by?: string;
  created_at: string;
  payerName?: string;
  splits?: ExpenseSplit[];
}

export interface ExpenseSplit {
  id: string;
  expense_id: string;
  profile_id?: string;
  member_id?: string; // UI helper alias for profile_id
  amount: number; // in paise
  share_amount?: number; // UI helper alias
  created_at?: string;
}

export interface SettlementPayment {
  id: string;
  trip_id: string;
  from_member: string;
  to_member: string;
  amount: number; // in paise
  method: string;
  note: string | null;
  paid_at: string;
  created_at: string;
}

export interface TripBalanceRow {
  trip_id: string;
  member_id: string;
  display_name: string;
  user_id: string | null;
  role: TripRole;
  status: MemberStatus;
  is_guest: boolean;
  total_paid: number; // in paise
  total_share: number; // in paise
  total_repaid: number; // in paise
  total_received: number; // in paise
  net_balance: number; // in paise (+ means gets back, - means owes)
}

export interface TripMessage {
  id: string;
  trip_id: string;
  sender_id: string;
  sender_name?: string;
  message?: string;
  content?: string;
  type?: 'text' | 'expense' | 'dispute' | 'system' | 'image' | 'document';
  chat_type?: 'group' | 'individual' | 'trip' | 'user';
  media_url?: string;
  media_name?: string;
  media_size?: string;
  expense_id?: string;
  expense_data?: {
    id: string;
    trip_id?: string;
    trip_name?: string;
    description: string;
    amount: number;
    currency?: string;
    paid_by_name: string;
    paid_by_id: string;
    split_count: number;
    category?: string;
    impact_paise?: number;
    is_group_expense?: boolean;
    date?: string;
    is_disputed?: boolean;
    dispute_reason?: string;
    disputed_by?: string;
  };
  created_at: string;
}


