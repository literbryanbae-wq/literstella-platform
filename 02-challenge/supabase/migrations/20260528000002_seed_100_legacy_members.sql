-- ==========================================
-- DEV: GENERATE 100 LEGACY MEMBERS
-- ==========================================

DO $$
DECLARE
    i INT;
    v_books TEXT[] := ARRAY['The Little Prince', 'Harry Potter and the Philosopher''s Stone', 'Anne of Green Gables', 'Daddy-Long-Legs', 'Pride and Prejudice'];
    v_nickname TEXT;
    v_phone TEXT;
BEGIN
    FOR i IN 1..100 LOOP
        v_nickname := '기존회원_' || LPAD(i::text, 3, '0');
        v_phone := '010' || LPAD(i::text, 8, '0');
        
        INSERT INTO public.legacy_members (
            user_id, name, email, phone, diagnostic_results, is_legacy_0_base_isolated
        ) VALUES (
            'LEGACY-' || LPAD(i::text, 3, '0'),
            '회원' || i,
            'legacy' || i || '@example.com',
            v_phone,
            jsonb_build_object(
                'previousBook', v_books[1 + floor(random() * array_length(v_books, 1))],
                'progressRate', floor(random() * 100),
                'lastCohort', '제12기 (2605)'
            ),
            TRUE
        ) ON CONFLICT (email) DO NOTHING;
    END LOOP;
END;
$$;
