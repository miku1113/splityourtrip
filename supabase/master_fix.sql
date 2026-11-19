-- ==============================================================================
-- Split Your Trip - Master Database Schema & RLS Setup
-- Execute this script in Supabase Dashboard -> SQL Editor
-- Project: https://supabase.com/dashboard/project/hpjizujbzvwkxvfsoqqd/sql
-- ==============================================================================

-- 1. PROFILES TABLE
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  name text,
  avatar_url text,
  phone_number text,
  currency text DEFAULT 'INR',
  country text DEFAULT 'India',
  upi_id text,
  push_token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone_number text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS currency text DEFAULT 'INR';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country text DEFAULT 'India';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS upi_id text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS push_token text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 2. TRIPS TABLE
CREATE TABLE IF NOT EXISTS public.trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text DEFAULT '',
  start_date date,
  end_date date,
  currency text NOT NULL DEFAULT 'INR',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'settled', 'archived')),
  trip_type text DEFAULT 'group',
  friend_id text,
  image_url text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS description text DEFAULT '';
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS end_date date;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'INR';
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS trip_type text DEFAULT 'group';
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS friend_id text;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS invite_code text DEFAULT substring(md5(random()::text) from 1 for 6);
ALTER TABLE public.trips ALTER COLUMN invite_code DROP NOT NULL;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 3. TRIP MEMBERS TABLE
CREATE TABLE IF NOT EXISTS public.trip_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name text NOT NULL DEFAULT 'Member',
  phone_number text,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  status text NOT NULL DEFAULT 'accepted' CHECK (status IN ('invited', 'accepted', 'declined')),
  is_guest boolean NOT NULL DEFAULT false,
  joined_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.trip_members ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.trip_members ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.trip_members ADD COLUMN IF NOT EXISTS display_name text NOT NULL DEFAULT 'Member';
ALTER TABLE public.trip_members ADD COLUMN IF NOT EXISTS phone_number text;
ALTER TABLE public.trip_members ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member';
ALTER TABLE public.trip_members ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'accepted';
ALTER TABLE public.trip_members ADD COLUMN IF NOT EXISTS is_guest boolean NOT NULL DEFAULT false;
ALTER TABLE public.trip_members ADD COLUMN IF NOT EXISTS joined_at timestamptz DEFAULT now();
ALTER TABLE public.trip_members ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- 4. EXPENSES TABLE
CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  paid_by uuid NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  description text NOT NULL,
  category text DEFAULT 'General',
  payment_mode text DEFAULT 'upi',
  upi_txn_id text,
  screenshot_path text,
  attachment_url text,
  attachment_name text,
  attachment_type text,
  location text,
  latitude double precision,
  longitude double precision,
  split_type text DEFAULT 'equal',
  currency text DEFAULT 'INR',
  date timestamptz DEFAULT now(),
  expense_date timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS category text DEFAULT 'General';
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS payment_mode text DEFAULT 'upi';
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS upi_txn_id text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS screenshot_path text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS attachment_url text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS attachment_name text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS attachment_type text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS location text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS longitude double precision;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS split_type text DEFAULT 'equal';
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS currency text DEFAULT 'INR';
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS date timestamptz DEFAULT now();
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS expense_date timestamptz DEFAULT now();
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS is_paused boolean DEFAULT false;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS is_disputed boolean DEFAULT false;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS dispute_reason text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS disputed_by uuid;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS disputed_by_name text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS disputed_at timestamptz;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_paid_by_fkey;

-- 5. EXPENSE SPLITS TABLE
CREATE TABLE IF NOT EXISTS public.expense_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  profile_id uuid,
  member_id uuid,
  amount bigint NOT NULL CHECK (amount >= 0),
  share_amount bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.expense_splits ADD COLUMN IF NOT EXISTS profile_id uuid;
ALTER TABLE public.expense_splits ADD COLUMN IF NOT EXISTS member_id uuid;
ALTER TABLE public.expense_splits ADD COLUMN IF NOT EXISTS share_amount bigint;
ALTER TABLE public.expense_splits ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- 6. TRIP MESSAGES (CHAT) TABLE
CREATE TABLE IF NOT EXISTS public.trip_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_name text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 7. INVITES TABLE
CREATE TABLE IF NOT EXISTS public.invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  invited_by uuid REFERENCES auth.users(id),
  expires_at timestamptz,
  max_uses integer DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 8. SETTLEMENT PAYMENTS TABLE
CREATE TABLE IF NOT EXISTS public.settlement_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  from_member uuid NOT NULL,
  to_member uuid NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  method text NOT NULL DEFAULT 'upi',
  note text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 9. SETTLEMENT SNAPSHOTS TABLE
CREATE TABLE IF NOT EXISTS public.settlement_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  generated_by uuid REFERENCES auth.users(id),
  payload jsonb NOT NULL,
  message_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ==============================================================================
-- 10. SECURITY DEFINER HELPER FUNCTIONS (Prevents Infinite RLS Recursion)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.is_member_of_trip(t_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trip_members
    WHERE trip_id = t_id AND (profile_id = auth.uid() OR user_id = auth.uid())
  );
$$;
REVOKE ALL ON FUNCTION public.is_member_of_trip(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_member_of_trip(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_creator_of_trip(t_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trips
    WHERE id = t_id AND created_by = auth.uid()
  );
$$;

-- ==============================================================================
-- 11. ENABLE RLS AND CONFIGURE PERMISSIVE POLICIES
-- ==============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_snapshots ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies to cleanly avoid duplicates
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END $$;

-- PROFILES POLICIES
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (true);

CREATE POLICY "profiles_insert" ON public.profiles
  FOR INSERT WITH CHECK (true);

CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE USING (true);

CREATE POLICY "profiles_delete" ON public.profiles
  FOR DELETE USING (true);

-- TRIPS POLICIES
CREATE POLICY "trips_select" ON public.trips
  FOR SELECT USING (true);

CREATE POLICY "trips_insert" ON public.trips
  FOR INSERT WITH CHECK (true);

CREATE POLICY "trips_update" ON public.trips
  FOR UPDATE USING (true);

CREATE POLICY "trips_delete" ON public.trips
  FOR DELETE USING (true);

-- TRIP MEMBERS POLICIES
CREATE POLICY "trip_members_select" ON public.trip_members
  FOR SELECT USING (true);

CREATE POLICY "trip_members_insert" ON public.trip_members
  FOR INSERT WITH CHECK (true);

CREATE POLICY "trip_members_update" ON public.trip_members
  FOR UPDATE USING (true);

CREATE POLICY "trip_members_delete" ON public.trip_members
  FOR DELETE USING (true);

-- EXPENSES POLICIES
CREATE POLICY "expenses_select" ON public.expenses
  FOR SELECT USING (true);

CREATE POLICY "expenses_insert" ON public.expenses
  FOR INSERT WITH CHECK (true);

CREATE POLICY "expenses_update" ON public.expenses
  FOR UPDATE USING (true);

CREATE POLICY "expenses_delete" ON public.expenses
  FOR DELETE USING (true);

-- EXPENSE SPLITS POLICIES
CREATE POLICY "expense_splits_select" ON public.expense_splits
  FOR SELECT USING (true);

CREATE POLICY "expense_splits_insert" ON public.expense_splits
  FOR INSERT WITH CHECK (true);

CREATE POLICY "expense_splits_update" ON public.expense_splits
  FOR UPDATE USING (true);

CREATE POLICY "expense_splits_delete" ON public.expense_splits
  FOR DELETE USING (true);

-- TRIP MESSAGES POLICIES
CREATE POLICY "trip_messages_select" ON public.trip_messages
  FOR SELECT USING (true);

CREATE POLICY "trip_messages_insert" ON public.trip_messages
  FOR INSERT WITH CHECK (true);

CREATE POLICY "trip_messages_update" ON public.trip_messages
  FOR UPDATE USING (true);

CREATE POLICY "trip_messages_delete" ON public.trip_messages
  FOR DELETE USING (true);

-- INVITES POLICIES
CREATE POLICY "invites_select" ON public.invites
  FOR SELECT USING (true);

CREATE POLICY "invites_insert" ON public.invites
  FOR INSERT WITH CHECK (true);

-- SETTLEMENT PAYMENTS POLICIES
CREATE POLICY "settlement_payments_select" ON public.settlement_payments
  FOR SELECT USING (true);

CREATE POLICY "settlement_payments_insert" ON public.settlement_payments
  FOR INSERT WITH CHECK (true);

CREATE POLICY "settlement_payments_update" ON public.settlement_payments
  FOR UPDATE USING (true);

CREATE POLICY "settlement_payments_delete" ON public.settlement_payments
  FOR DELETE USING (true);

-- SETTLEMENT SNAPSHOTS POLICIES
CREATE POLICY "settlement_snapshots_select" ON public.settlement_snapshots
  FOR SELECT USING (true);

CREATE POLICY "settlement_snapshots_insert" ON public.settlement_snapshots
  FOR INSERT WITH CHECK (true);

CREATE POLICY "settlement_snapshots_update" ON public.settlement_snapshots
  FOR UPDATE USING (true);

CREATE POLICY "settlement_snapshots_delete" ON public.settlement_snapshots
  FOR DELETE USING (true);

-- ==============================================================================
-- 12. AUTO-PROFILE TRIGGER FOR NEW USERS & BACKFILL
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, name, avatar_url, phone_number, currency, country)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    COALESCE(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', null),
    COALESCE(new.raw_user_meta_data->>'phone_number', new.phone, null),
    COALESCE(new.raw_user_meta_data->>'currency', 'INR'),
    COALESCE(new.raw_user_meta_data->>'country', 'India')
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
    name = COALESCE(EXCLUDED.name, profiles.name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url),
    phone_number = COALESCE(EXCLUDED.phone_number, profiles.phone_number),
    updated_at = now();
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill all existing users from auth.users into profiles
INSERT INTO public.profiles (id, full_name, name, avatar_url, phone_number, currency, country)
SELECT
  id,
  COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', split_part(email, '@', 1)),
  COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', split_part(email, '@', 1)),
  COALESCE(raw_user_meta_data->>'avatar_url', raw_user_meta_data->>'picture', NULL),
  COALESCE(raw_user_meta_data->>'phone_number', phone, NULL),
  COALESCE(raw_user_meta_data->>'currency', 'INR'),
  COALESCE(raw_user_meta_data->>'country', 'India')
FROM auth.users
ON CONFLICT (id) DO UPDATE SET
  full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
  name = COALESCE(EXCLUDED.name, profiles.name),
  avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url),
  phone_number = COALESCE(EXCLUDED.phone_number, profiles.phone_number);

-- ==============================================================================
-- 13. STORAGE BUCKETS (avatars & attachments)
-- ==============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

INSERT INTO storage.buckets (id, name, public)
VALUES ('attachments', 'attachments', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Drop storage policies if they exist to avoid collision
DROP POLICY IF EXISTS "Public read for avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Public read for attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload attachments" ON storage.objects;

CREATE POLICY "Public read for avatars" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

CREATE POLICY "Authenticated users can upload avatars" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'avatars' AND auth.role() = 'authenticated');

CREATE POLICY "Users can update own avatar" ON storage.objects
  FOR UPDATE USING (bucket_id = 'avatars' AND auth.role() = 'authenticated');

CREATE POLICY "Public read for attachments" ON storage.objects
  FOR SELECT USING (bucket_id = 'attachments');

CREATE POLICY "Authenticated users can upload attachments" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'attachments' AND auth.role() = 'authenticated');

-- ==============================================================================
-- 14. REALTIME PUBLICATION
-- ==============================================================================

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trips;
  EXCEPTION WHEN others THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_members;
  EXCEPTION WHEN others THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.expenses;
  EXCEPTION WHEN others THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.expense_splits;
  EXCEPTION WHEN others THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_messages;
  EXCEPTION WHEN others THEN NULL;
  END;
END $$;

-- ==============================================================================
-- 15. AUTO-LINK UNREGISTERED SPLITS (When an unlinked contact signs up)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.claim_unlinked_splits(target_user_id uuid, target_phone text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clean_phone text;
  claimed_members_count int := 0;
  claimed_trips_count int := 0;
  member_ids uuid[];
BEGIN
  IF target_phone IS NULL OR length(trim(target_phone)) < 6 THEN
    RETURN json_build_object('success', false, 'reason', 'Invalid phone number');
  END IF;

  -- Extract last 10 digits to normalize against country codes and formats
  clean_phone := right(regexp_replace(target_phone, '[^0-9]', '', 'g'), 10);
  IF length(clean_phone) < 6 THEN
    RETURN json_build_object('success', false, 'reason', 'Phone too short');
  END IF;

  -- Find all unlinked trip_members whose normalized phone matches
  SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO member_ids
  FROM public.trip_members
  WHERE (profile_id IS NULL OR profile_id != target_user_id)
    AND phone_number IS NOT NULL
    AND right(regexp_replace(phone_number, '[^0-9]', '', 'g'), 10) = clean_phone;

  IF array_length(member_ids, 1) > 0 THEN
    -- 1. Link trip members to the registered user
    UPDATE public.trip_members
    SET
      profile_id = target_user_id,
      user_id = target_user_id,
      is_guest = false
    WHERE id = ANY(member_ids);

    GET DIAGNOSTICS claimed_members_count = ROW_COUNT;

    -- 2. Link splits to the registered user profile
    UPDATE public.expense_splits
    SET profile_id = target_user_id
    WHERE member_id = ANY(member_ids)
      AND (profile_id IS NULL OR profile_id != target_user_id);

    -- 3. Link friend_split trips if friend_id was phone or contact
    UPDATE public.trips
    SET friend_id = target_user_id::text
    WHERE trip_type = 'friend_split'
      AND friend_id IS NOT NULL
      AND (
        right(regexp_replace(friend_id, '[^0-9]', '', 'g'), 10) = clean_phone
        OR id IN (SELECT trip_id FROM public.trip_members WHERE id = ANY(member_ids))
      );

    GET DIAGNOSTICS claimed_trips_count = ROW_COUNT;
  END IF;

  RETURN json_build_object(
    'success', true,
    'claimed_members', claimed_members_count,
    'claimed_trips', claimed_trips_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_unlinked_splits(uuid, text) TO authenticated, anon;

-- ==============================================================================
-- 15. USER BLOCKS TABLE (Bilateral Contact Blocking)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.user_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_phone text,
  blocked_name text,
  trip_id uuid REFERENCES public.trips(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_blocks_unique_pair UNIQUE (blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker_id ON public.user_blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked_id ON public.user_blocks(blocked_id);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked_phone ON public.user_blocks(blocked_phone);

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_blocks_select" ON public.user_blocks;
CREATE POLICY "user_blocks_select" ON public.user_blocks
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "user_blocks_insert" ON public.user_blocks;
CREATE POLICY "user_blocks_insert" ON public.user_blocks
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "user_blocks_delete" ON public.user_blocks;
CREATE POLICY "user_blocks_delete" ON public.user_blocks
  FOR DELETE USING (true);

-- Reapply the restrictive policy set and invite RPC after the legacy setup above.
-- Restrict app data to authenticated users who own or belong to each trip.
CREATE OR REPLACE FUNCTION public.is_member_of_trip(t_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.trip_members tm WHERE tm.trip_id = t_id
    AND (tm.profile_id = auth.uid() OR tm.user_id = auth.uid()))
    OR EXISTS (SELECT 1 FROM public.trips t WHERE t.id = t_id AND t.created_by = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_trip_admin(t_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.trips t WHERE t.id = t_id AND t.created_by = auth.uid())
    OR EXISTS (SELECT 1 FROM public.trip_members tm WHERE tm.trip_id = t_id
      AND (tm.profile_id = auth.uid() OR tm.user_id = auth.uid()) AND tm.role = 'admin');
$$;
REVOKE ALL ON FUNCTION public.is_trip_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_trip_admin(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.join_trip_by_code(p_code text, p_display_name text DEFAULT 'Traveler', p_phone text DEFAULT NULL)
RETURNS TABLE(trip_id uuid, trip_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target public.trips%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO target FROM public.trips t WHERE upper(t.invite_code) = upper(trim(p_code)) LIMIT 1;
  IF target.id IS NULL THEN RAISE EXCEPTION 'Invalid invite code'; END IF;
  INSERT INTO public.trip_members(trip_id, profile_id, user_id, display_name, phone_number, role, status, is_guest)
  VALUES(target.id, auth.uid(), auth.uid(), coalesce(nullif(trim(p_display_name), ''), 'Traveler'), p_phone, 'member', 'accepted', false)
  ON CONFLICT (trip_id, profile_id) DO UPDATE SET user_id = EXCLUDED.user_id, status = 'accepted';
  RETURN QUERY SELECT target.id, target.name;
END; $$;
REVOKE ALL ON FUNCTION public.join_trip_by_code(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_trip_by_code(text, text, text) TO authenticated;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.trip_members'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (trip_id, profile_id)'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS trip_members_trip_profile_unique
      ON public.trip_members(trip_id, profile_id) WHERE profile_id IS NOT NULL;
  END IF;
END $$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT schemaname, tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('profiles','trips','trip_members','expenses','expense_splits','trip_messages','invites','settlement_payments','settlement_snapshots','user_blocks')
  LOOP EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename); END LOOP;
END $$;

CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated USING (
  id = auth.uid() OR EXISTS (SELECT 1 FROM public.trip_members mine JOIN public.trip_members theirs ON theirs.trip_id = mine.trip_id WHERE mine.profile_id = auth.uid() AND theirs.profile_id = profiles.id)
);
CREATE POLICY profiles_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY trips_select ON public.trips FOR SELECT TO authenticated USING (public.is_member_of_trip(id));
CREATE POLICY trips_insert ON public.trips FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY trips_update ON public.trips FOR UPDATE TO authenticated USING (public.is_trip_admin(id)) WITH CHECK (public.is_trip_admin(id));
CREATE POLICY trips_delete ON public.trips FOR DELETE TO authenticated USING (public.is_trip_admin(id));
CREATE POLICY trip_members_select ON public.trip_members FOR SELECT TO authenticated USING (public.is_member_of_trip(trip_id));
CREATE POLICY trip_members_insert ON public.trip_members FOR INSERT TO authenticated WITH CHECK (public.is_trip_admin(trip_id));
CREATE POLICY trip_members_update ON public.trip_members FOR UPDATE TO authenticated USING (public.is_trip_admin(trip_id)) WITH CHECK (public.is_trip_admin(trip_id));
CREATE POLICY trip_members_delete ON public.trip_members FOR DELETE TO authenticated USING (public.is_trip_admin(trip_id) OR profile_id = auth.uid() OR user_id = auth.uid());
CREATE POLICY expenses_select ON public.expenses FOR SELECT TO authenticated USING (public.is_member_of_trip(trip_id));
CREATE POLICY expenses_insert ON public.expenses FOR INSERT TO authenticated WITH CHECK (public.is_member_of_trip(trip_id) AND created_by = auth.uid());
CREATE POLICY expenses_update ON public.expenses FOR UPDATE TO authenticated USING (public.is_member_of_trip(trip_id)) WITH CHECK (public.is_member_of_trip(trip_id));
CREATE POLICY expenses_delete ON public.expenses FOR DELETE TO authenticated USING (public.is_member_of_trip(trip_id));
CREATE POLICY expense_splits_select ON public.expense_splits FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.expenses e WHERE e.id = expense_id AND public.is_member_of_trip(e.trip_id)));
CREATE POLICY expense_splits_insert ON public.expense_splits FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.expenses e WHERE e.id = expense_id AND public.is_member_of_trip(e.trip_id)));
CREATE POLICY expense_splits_update ON public.expense_splits FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.expenses e WHERE e.id = expense_id AND public.is_member_of_trip(e.trip_id)));
CREATE POLICY expense_splits_delete ON public.expense_splits FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.expenses e WHERE e.id = expense_id AND public.is_member_of_trip(e.trip_id)));
CREATE POLICY trip_messages_select ON public.trip_messages FOR SELECT TO authenticated USING (public.is_member_of_trip(trip_id));
CREATE POLICY trip_messages_insert ON public.trip_messages FOR INSERT TO authenticated WITH CHECK (public.is_member_of_trip(trip_id) AND sender_id = auth.uid());
CREATE POLICY trip_messages_update ON public.trip_messages FOR UPDATE TO authenticated USING (public.is_member_of_trip(trip_id) AND sender_id = auth.uid());
CREATE POLICY trip_messages_delete ON public.trip_messages FOR DELETE TO authenticated USING (public.is_member_of_trip(trip_id) AND (sender_id = auth.uid() OR public.is_trip_admin(trip_id)));
CREATE POLICY invites_select ON public.invites FOR SELECT TO authenticated USING (public.is_trip_admin(trip_id));
CREATE POLICY invites_insert ON public.invites FOR INSERT TO authenticated WITH CHECK (public.is_trip_admin(trip_id) AND invited_by = auth.uid());
CREATE POLICY settlement_payments_select ON public.settlement_payments FOR SELECT TO authenticated USING (public.is_member_of_trip(trip_id));
CREATE POLICY settlement_payments_insert ON public.settlement_payments FOR INSERT TO authenticated WITH CHECK (public.is_member_of_trip(trip_id));
CREATE POLICY settlement_payments_update ON public.settlement_payments FOR UPDATE TO authenticated USING (public.is_member_of_trip(trip_id));
CREATE POLICY settlement_payments_delete ON public.settlement_payments FOR DELETE TO authenticated USING (public.is_trip_admin(trip_id));
CREATE POLICY settlement_snapshots_select ON public.settlement_snapshots FOR SELECT TO authenticated USING (public.is_member_of_trip(trip_id));
CREATE POLICY settlement_snapshots_insert ON public.settlement_snapshots FOR INSERT TO authenticated WITH CHECK (public.is_member_of_trip(trip_id) AND generated_by = auth.uid());
CREATE POLICY user_blocks_select ON public.user_blocks FOR SELECT TO authenticated USING (blocker_id = auth.uid());
CREATE POLICY user_blocks_insert ON public.user_blocks FOR INSERT TO authenticated WITH CHECK (blocker_id = auth.uid());
CREATE POLICY user_blocks_delete ON public.user_blocks FOR DELETE TO authenticated USING (blocker_id = auth.uid());

DO $$ BEGIN
  IF to_regclass('public.messages') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS messages_member_select ON public.messages';
    EXECUTE 'DROP POLICY IF EXISTS messages_member_insert ON public.messages';
    EXECUTE 'DROP POLICY IF EXISTS messages_sender_update ON public.messages';
    EXECUTE 'DROP POLICY IF EXISTS messages_sender_delete ON public.messages';
    EXECUTE 'CREATE POLICY messages_member_select ON public.messages FOR SELECT TO authenticated USING (public.is_member_of_trip(trip_id))';
    EXECUTE 'CREATE POLICY messages_member_insert ON public.messages FOR INSERT TO authenticated WITH CHECK (public.is_member_of_trip(trip_id) AND sender_id = auth.uid())';
    EXECUTE 'CREATE POLICY messages_sender_update ON public.messages FOR UPDATE TO authenticated USING (public.is_member_of_trip(trip_id) AND sender_id = auth.uid())';
    EXECUTE 'CREATE POLICY messages_sender_delete ON public.messages FOR DELETE TO authenticated USING (public.is_member_of_trip(trip_id) AND (sender_id = auth.uid() OR public.is_trip_admin(trip_id)))';
  END IF;
END $$;
