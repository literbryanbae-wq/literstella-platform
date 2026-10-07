-- Apply only after the compatible API validator is live. No grants or old receipts change.
DO $migration$
DECLARE
  definition text;
  updated text;
BEGIN
  LOCK TABLE public.growth_panel_campaigns IN EXCLUSIVE MODE;
  SELECT pg_get_functiondef('public.growth_panel_request(text,text,uuid,text,jsonb)'::regprocedure) INTO definition;
  IF md5(definition) <> '695bcede6e073ccf602b2bd489dac9f8' THEN
    RAISE EXCEPTION 'Growth panel RPC changed: review before migration';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.growth_panel_campaigns
    WHERE id = 'growth-quality-panel-v1' AND ownership_policy = 'classic7-plus-theory-explicit'
      AND policy_version = '2026-09-05-v1') THEN
    RAISE EXCEPTION 'Growth panel campaign changed: review before migration';
  END IF;
  updated := replace(definition,
    'and campaign.ownership_policy = ''classic7-plus-theory-explicit'' and cardinality(campaign.required_books) = 8',
    'and campaign.ownership_policy = ''classic-one-explicit'' and cardinality(campaign.required_books) = 7');
  updated := replace(updated,
    'and campaign.required_books @> all_books and campaign.required_books <@ all_books',
    'and campaign.required_books @> array_remove(all_books, ''theory'') and campaign.required_books <@ array_remove(all_books, ''theory'')');
  updated := replace(updated, 'eligible := owned @> all_books;',
    'eligible := owned && campaign.required_books;');
  updated := replace(updated, '''requiredBooks'', campaign.required_books,',
    '''minimumOwnedBooks'', 1, ''requiredBooks'', campaign.required_books,');
  IF updated = definition OR updated LIKE '%eligible := owned @> all_books;%'
    OR updated NOT LIKE '%''minimumOwnedBooks'', 1%' THEN
    RAISE EXCEPTION 'Growth panel replacement did not match';
  END IF;
  ALTER TABLE public.growth_panel_campaigns DROP CONSTRAINT growth_panel_campaigns_ownership_policy_check;
  ALTER TABLE public.growth_panel_campaigns DROP CONSTRAINT growth_panel_campaigns_required_books_check;
  ALTER TABLE public.growth_panel_campaigns ADD CONSTRAINT growth_panel_campaigns_ownership_policy_check
    CHECK (ownership_policy IN ('classic7-plus-theory-explicit', 'classic-one-explicit'));
  ALTER TABLE public.growth_panel_campaigns ADD CONSTRAINT growth_panel_campaigns_required_books_check CHECK (
    (ownership_policy = 'classic7-plus-theory-explicit' AND cardinality(required_books) = 8
      AND required_books @> ARRAY['kidari','anne','littlewomen1','littlewomen2','pride','gatsby','sherlock','theory']
      AND required_books <@ ARRAY['kidari','anne','littlewomen1','littlewomen2','pride','gatsby','sherlock','theory'])
    OR (ownership_policy = 'classic-one-explicit' AND cardinality(required_books) = 7
      AND required_books @> ARRAY['kidari','anne','littlewomen1','littlewomen2','pride','gatsby','sherlock']
      AND required_books <@ ARRAY['kidari','anne','littlewomen1','littlewomen2','pride','gatsby','sherlock']));
  UPDATE public.growth_panel_campaigns SET ownership_policy = 'classic-one-explicit',
    required_books = ARRAY['kidari','anne','littlewomen1','littlewomen2','pride','gatsby','sherlock'],
    policy_version = '2026-10-08-one-owned-v1'
    WHERE id = 'growth-quality-panel-v1';
  EXECUTE updated;
END;
$migration$;
