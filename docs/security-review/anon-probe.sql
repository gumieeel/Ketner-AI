-- Попытки ролей API прочитать и очистить таблицы (откатываются). Результат — строка на таблицу и роль.
SET client_min_messages = warning;
\pset format unaligned
\pset tuples_only on
CREATE TEMP TABLE probe (role text, tbl text, sel text, trunc text);
DO $$
DECLARE r text; t text; n bigint; sel text; tr text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH t IN ARRAY ARRAY['ketner_docs', 'session', 'github_connections', 'solutions', 'bot_leads', 'pricing_versions'] LOOP
      CONTINUE WHEN to_regclass(format('public.%I', t)) IS NULL;
      EXECUTE format('SET LOCAL ROLE %I', r);
      BEGIN EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n; sel := 'select ok (' || n || ' rows)';
      EXCEPTION WHEN OTHERS THEN sel := SQLSTATE; END;
      BEGIN EXECUTE format('TRUNCATE public.%I CASCADE', t); tr := 'truncate ok'; RAISE EXCEPTION USING ERRCODE = 'P0099';
      EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL; WHEN OTHERS THEN tr := SQLSTATE; END;
      RESET ROLE;
      INSERT INTO probe VALUES (r, t, sel, tr);
    END LOOP;
  END LOOP;
END $$;
SELECT role || '|' || tbl || '|' || sel || '|' || trunc FROM probe ORDER BY role, tbl;
