-- ==========================================
-- Migration: Add unique constraint to legacy_members email
-- ==========================================

-- Ensure email is unique to support ON CONFLICT
ALTER TABLE public.legacy_members ADD CONSTRAINT legacy_members_email_key UNIQUE (email);
