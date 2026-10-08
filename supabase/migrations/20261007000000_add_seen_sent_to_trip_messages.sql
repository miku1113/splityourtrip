-- Migration: Add seen, sent, edited tracking to trip_messages and messages
ALTER TABLE public.trip_messages ADD COLUMN IF NOT EXISTS is_sent boolean DEFAULT true;
ALTER TABLE public.trip_messages ADD COLUMN IF NOT EXISTS is_seen boolean DEFAULT false;
ALTER TABLE public.trip_messages ADD COLUMN IF NOT EXISTS is_edited boolean DEFAULT false;
ALTER TABLE public.trip_messages ADD COLUMN IF NOT EXISTS seen_at timestamptz;

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_sent boolean DEFAULT true;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_seen boolean DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_edited boolean DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS seen_at timestamptz;
