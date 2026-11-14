-- Отпечаток данных всех таблиц схемы public: имя | строк | md5 строк в порядке текста.
\set ON_ERROR_STOP 1
DO $$
DECLARE t text; n bigint; h text;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS state_rows (table_name text, row_count bigint, checksum text);
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename LOOP
    EXECUTE format('SELECT count(*), coalesce(md5(string_agg(x::text, ''|'' ORDER BY x::text)), ''-'') FROM public.%I x', t) INTO n, h;
    INSERT INTO state_rows VALUES (t, n, h);
  END LOOP;
END $$;
SELECT table_name || '|' || row_count || '|' || checksum FROM state_rows ORDER BY table_name;
