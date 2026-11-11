-- 20261112000000_add_expense_dispute_pause.sql
-- Migration to support pausing and disputing expenses in SplitYourTrip

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS is_paused boolean DEFAULT false;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS is_disputed boolean DEFAULT false;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS dispute_reason text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS disputed_by uuid;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS disputed_by_name text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS disputed_at timestamptz;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';

-- Create indexes for performance when filtering by status and pause state
CREATE INDEX IF NOT EXISTS idx_expenses_is_paused ON public.expenses(trip_id, is_paused);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON public.expenses(trip_id, status);
