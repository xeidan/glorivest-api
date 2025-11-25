-- Backfill missing account codes using per-user sequence
DO $$
DECLARE
  rec RECORD;
  seq INT;
  code TEXT;
  base INT;
  tier_slug TEXT;
BEGIN
  FOR rec IN
    SELECT a.*, t.slug AS tier_slug
    FROM accounts a
    LEFT JOIN account_tiers t ON t.id = a.tier_id
    WHERE a.account_code IS NULL OR a.account_code = ''
    ORDER BY a.user_id, a.id
  LOOP
    -- compute base
    base := 150000 + rec.user_id;

    -- compute per-user index (seq)
    SELECT COUNT(*) + 1 INTO seq
    FROM accounts
    WHERE user_id = rec.user_id
      AND id < rec.id;

    -- tier code map
    IF rec.tier_slug = 'standard' THEN tier_slug := 'STD';
    ELSIF rec.tier_slug = 'pro' THEN tier_slug := 'PRO';
    ELSIF rec.tier_slug = 'elite' THEN tier_slug := 'ELT';
    ELSE tier_slug := UPPER(SUBSTRING(rec.tier_slug,1,3));
    END IF;

    code := 'GV' || base || '-' || LPAD(seq::text, 2, '0') || '-' || tier_slug;

    UPDATE accounts SET account_code = code WHERE id = rec.id;
  END LOOP;
END $$;

