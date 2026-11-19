-- Restrict app data to authenticated users who own or belong to each trip.
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

CREATE OR REPLACE FUNCTION public.is_member_of_trip(t_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.trip_members tm WHERE tm.trip_id = t_id
    AND (tm.profile_id = auth.uid() OR tm.user_id = auth.uid()))
    OR EXISTS (SELECT 1 FROM public.trips t WHERE t.id = t_id AND t.created_by = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.is_member_of_trip(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_member_of_trip(uuid) TO authenticated;

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

-- Some deployed versions also mirror chat into public.messages. Lock that
-- compatibility table down when present instead of leaving it outside RLS.
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
