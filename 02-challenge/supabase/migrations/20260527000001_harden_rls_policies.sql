-- ==========================================
-- Hardening RLS Policies to resolve rls_policy_always_true warnings
-- Target: challenge_participants, challenge_books, challenge_certifications
-- ==========================================

-- 1. challenge_participants 정책 강화
-- 누구나 신청할 수 있지만, 상태(status)는 반드시 'applied'여야 하고 결제 상태는 'pending'이어야 함
DROP POLICY IF EXISTS "Allow public insert access" ON public.challenge_participants;
CREATE POLICY "Allow public insert access" ON public.challenge_participants 
FOR INSERT 
WITH CHECK (
    status = 'applied' AND 
    payment_status = 'pending'
);

-- 2. challenge_books 정책 강화
-- 초기 도서 상태는 반드시 'reading' 또는 'planned'여야 함
DROP POLICY IF EXISTS "Allow public insert access" ON public.challenge_books;
CREATE POLICY "Allow public insert access" ON public.challenge_books 
FOR INSERT 
WITH CHECK (
    status IN ('planned', 'reading')
);

-- 3. challenge_certifications 정책 강화
-- 인증 제출 시 상태는 반드시 'submitted'여야 함
DROP POLICY IF EXISTS "Allow public insert access" ON public.challenge_certifications;
CREATE POLICY "Allow public insert access" ON public.challenge_certifications 
FOR INSERT 
WITH CHECK (
    status = 'submitted'
);
