-- Нормализованный снимок базы: каждая строка — «раздел | объект | свойства».
-- Объекты сравниваются по именам, а не по OID. Исключено (и почему) — в docs/PERSISTENCE_DESIGN.md, 7.2:
-- OID и relfilenode (внутренние номера), статистика планировщика (reltuples, relpages, relallvisible).
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
WITH
app_ns AS (
  SELECT oid, nspname FROM pg_namespace
  WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND nspname NOT LIKE 'pg_temp_%' AND nspname NOT LIKE 'pg_toast_temp_%'
),
rows AS (
  SELECT 'schema' AS section, n.nspname AS object,
         'owner=' || pg_get_userbyid(s.nspowner) || ' acl=' || coalesce(s.nspacl::text, '-') AS props
  FROM app_ns n JOIN pg_namespace s ON s.oid = n.oid
  UNION ALL
  SELECT 'extension', extname, 'version=' || extversion || ' schema=' || extnamespace::regnamespace::text FROM pg_extension
  UNION ALL
  SELECT 'relation', n.nspname || '.' || c.relname,
         'kind=' || c.relkind::text || ' owner=' || pg_get_userbyid(c.relowner) || ' persistence=' || c.relpersistence::text
         || ' rls=' || c.relrowsecurity || ' force_rls=' || c.relforcerowsecurity || ' hastriggers=' || c.relhastriggers
         || ' hasindex=' || c.relhasindex || ' options=' || coalesce(c.reloptions::text, '-') || ' acl=' || coalesce(c.relacl::text, '-')
  FROM pg_class c JOIN app_ns n ON n.oid = c.relnamespace
  WHERE c.relkind::text IN ('r', 'p', 'v', 'm', 'S', 'f', 'i')
  UNION ALL
  -- Колонки, включая удалённые (attisdropped): они остаются в каталоге после DROP COLUMN.
  SELECT 'column', n.nspname || '.' || c.relname || '.' || lpad(a.attnum::text, 3, '0') || ':' || a.attname,
         'type=' || format_type(a.atttypid, a.atttypmod) || ' notnull=' || a.attnotnull || ' dropped=' || a.attisdropped
         || ' identity=' || a.attidentity::text || ' generated=' || a.attgenerated::text
         || ' default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-') || ' acl=' || coalesce(a.attacl::text, '-')
  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN app_ns n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attnum > 0 AND c.relkind::text IN ('r', 'p', 'v', 'm', 'f')
  UNION ALL
  SELECT 'constraint', n.nspname || '.' || c.relname || '.' || co.conname,
         'type=' || co.contype::text || ' deferrable=' || co.condeferrable || ' def=' || pg_get_constraintdef(co.oid)
  FROM pg_constraint co JOIN pg_class c ON c.oid = co.conrelid JOIN app_ns n ON n.oid = c.relnamespace
  UNION ALL
  SELECT 'index', n.nspname || '.' || i.relname, pg_get_indexdef(i.oid)
  FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid JOIN app_ns n ON n.oid = i.relnamespace
  UNION ALL
  SELECT 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         'returns=' || pg_get_function_result(p.oid) || ' owner=' || pg_get_userbyid(p.proowner) || ' secdef=' || p.prosecdef
         || ' volatility=' || p.provolatile::text || ' src_md5=' || md5(p.prosrc) || ' acl=' || coalesce(p.proacl::text, '-')
  FROM pg_proc p JOIN app_ns n ON n.oid = p.pronamespace
  UNION ALL
  SELECT 'trigger', n.nspname || '.' || c.relname || '.' || t.tgname,
         'enabled=' || t.tgenabled::text || ' def=' || pg_get_triggerdef(t.oid)
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN app_ns n ON n.oid = c.relnamespace
  WHERE NOT t.tgisinternal
  UNION ALL
  -- Внутренние триггеры внешних ключей (RI): считаем по таблицам, чтобы увидеть след удалённых связей.
  SELECT 'ri_triggers', n.nspname || '.' || c.relname, 'count=' || count(*)
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN app_ns n ON n.oid = c.relnamespace
  WHERE t.tgisinternal GROUP BY n.nspname, c.relname
  UNION ALL
  SELECT 'sequence', schemaname || '.' || sequencename,
         'type=' || data_type || ' start=' || start_value || ' inc=' || increment_by || ' last=' || coalesce(last_value::text, '-')
  FROM pg_sequences
  UNION ALL
  SELECT 'policy', schemaname || '.' || tablename || '.' || policyname,
         'cmd=' || cmd || ' roles=' || roles::text || ' using=' || coalesce(qual, '-') || ' check=' || coalesce(with_check, '-')
  FROM pg_policies
  UNION ALL
  SELECT 'default_acl', pg_get_userbyid(defaclrole) || ' ' || coalesce(defaclnamespace::regnamespace::text, '*') || ' ' || defaclobjtype::text,
         defaclacl::text
  FROM pg_default_acl
  UNION ALL
  SELECT 'type', n.nspname || '.' || t.typname, 'kind=' || t.typtype::text || ' owner=' || pg_get_userbyid(t.typowner)
  FROM pg_type t JOIN app_ns n ON n.oid = t.typnamespace
  WHERE t.typtype::text IN ('e', 'd', 'r', 'm') OR (t.typtype::text = 'c' AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = t.typrelid AND c.relkind::text <> 'c'))
  UNION ALL
  SELECT 'view', schemaname || '.' || viewname, md5(definition) FROM pg_views WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
  UNION ALL
  SELECT 'migration', id, 'checksum=' || checksum || ' applied_at=' || applied_at FROM schema_migrations
)
SELECT section || ' | ' || object || ' | ' || props FROM rows ORDER BY section, object, props;
