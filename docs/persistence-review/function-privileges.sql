-- Функции предложения: никто, кроме владельца (сервера), не может их вызвать. Запускается суперпользователем
-- после предложения; права по умолчанию в стиле Supabase выдают роли API EXECUTE на новые функции.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
CREATE TEMP TABLE fn_results (fn text, check_name text, result text);
DO $$
DECLARE
  f text;
  r text;
  ok boolean;
BEGIN
  FOREACH f IN ARRAY ARRAY['platform_contains_secret(jsonb)', 'platform_append_only()', 'executions_insert_refs()', 'execution_effects_guard()'] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'ketner_backend'] LOOP
      ok := has_function_privilege(r, ('public.' || f)::regprocedure, 'EXECUTE');
      INSERT INTO fn_results VALUES (f, r || ' can execute',
        CASE WHEN ok = (r = 'ketner_backend') THEN 'PASS: ' ELSE 'FAIL: ' END || ok::text);
    END LOOP;
    ok := EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  WHERE p.oid = ('public.' || f)::regprocedure AND a.grantee = 0);
    INSERT INTO fn_results VALUES (f, 'PUBLIC can execute', CASE WHEN ok THEN 'FAIL: true' ELSE 'PASS: false' END);
  END LOOP;
  -- Вызов через роль API (как через Data API: SELECT от anon) — отказ 42501.
  -- Результат запоминается в переменной и записывается уже после RESET ROLE: запись в таблицу результатов
  -- от имени anon сама дала бы 42501 и выглядела бы как успех проверки.
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.platform_contains_secret('{"a":1}'::jsonb);
    f := 'FAIL: call succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    f := 'PASS: 42501 ' || left(SQLERRM, 50);
  END;
  RESET ROLE;
  INSERT INTO fn_results VALUES ('platform_contains_secret(jsonb)', 'anon calls it', f);
END $$;
SELECT fn || ' | ' || check_name || ' | ' || result FROM fn_results ORDER BY fn, check_name;
SELECT 'functions: passed=' || count(*) FILTER (WHERE result LIKE 'PASS%') || ' failed=' || count(*) FILTER (WHERE result LIKE 'FAIL%') FROM fn_results;
