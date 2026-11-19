-- ==============================================================================
-- Migration: Create user_blocks table for bilateral friend blocking
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
