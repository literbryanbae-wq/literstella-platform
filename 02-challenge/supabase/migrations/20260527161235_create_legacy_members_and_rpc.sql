-- ==========================================
-- Migration: Create Legacy Members table and Enrollment RPC
-- 1. Create legacy_members table for storage of seed data
-- 2. Create RPC for enrollment verification with dual-identifier rule
-- ==========================================

-- [1. Legacy Members Storage]
CREATE TABLE IF NOT EXISTS public.legacy_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT UNIQUE,
    name TEXT,
    email TEXT,
    phone TEXT, -- Normalized phone number (no hyphens)
    diagnostic_results JSONB,
    is_legacy_0_base_isolated BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexing for dual-identifier lookup
CREATE INDEX IF NOT EXISTS idx_legacy_email ON public.legacy_members(email);
CREATE INDEX IF NOT EXISTS idx_legacy_phone ON public.legacy_members(phone);

-- [2. Enrollment Verification RPC]
-- Function to verify enrollment and link legacy data
CREATE OR REPLACE FUNCTION public.fn_verify_and_link_enrollment(
    p_email TEXT,
    p_phone TEXT
)
RETURNS TABLE (
    match_found BOOLEAN,
    user_id TEXT,
    is_legacy BOOLEAN
) 
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with elevated privileges to check private member table
SET search_path = public
AS $$
DECLARE
    v_normalized_phone TEXT;
    v_match_user_id TEXT;
BEGIN
    -- Normalize input phone: remove non-digits
    v_normalized_phone := regexp_replace(p_phone, '\D', '', 'g');

    -- Search for existing match in legacy_members
    SELECT lm.user_id INTO v_match_user_id
    FROM public.legacy_members lm
    WHERE lm.email = p_email OR lm.phone = v_normalized_phone
    LIMIT 1;

    IF v_match_user_id IS NOT NULL THEN
        RETURN QUERY SELECT TRUE, v_match_user_id, TRUE;
    ELSE
        RETURN QUERY SELECT FALSE, NULL::TEXT, FALSE;
    END IF;
END;
$$;

-- RLS for legacy_members (private, only accessible via RPC or service_role)
ALTER TABLE public.legacy_members ENABLE ROW LEVEL SECURITY;
-- No public policies means only superusers/security definer functions can read.
