-- ==========================================
-- Migration: Add phone and legacy_user_id to challenge_participants
-- ==========================================

ALTER TABLE public.challenge_participants 
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS legacy_user_id TEXT;

-- Update RLS policy to allow selecting the new columns for anon if needed
-- Previously we granted specific columns to anon. Let's update that.
GRANT SELECT (phone) ON public.challenge_participants TO anon;
