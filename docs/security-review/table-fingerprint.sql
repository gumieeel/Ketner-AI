-- Отпечаток данных схемы public: таблица | строк | md5 всех строк. Только SELECT (работает в READ ONLY).
-- Запускается на production ПЕРЕД копией и на восстановленной копии; результаты должны совпасть.
-- Пока снимается отпечаток, в базу могут писать — поэтому копию и отпечаток делать в окно без записи
-- или сравнивать только таблицы, которые не менялись (см. SECURITY_PRIVILEGE_AUDIT.md, 7).
SELECT c.relname AS table_name,
       (xpath('/row/n/text()', x))[1]::text AS row_count,
       coalesce((xpath('/row/h/text()', x))[1]::text, '-') AS checksum
FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
CROSS JOIN LATERAL query_to_xml(
  format('SELECT count(*) AS n, md5(string_agg(t::text, %L ORDER BY t::text)) AS h FROM public.%I t', '|', c.relname),
  false, true, '') AS x
WHERE ns.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;
