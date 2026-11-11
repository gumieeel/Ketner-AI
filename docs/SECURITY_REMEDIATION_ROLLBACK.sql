-- Откат docs/SECURITY_REMEDIATION_PROPOSAL.sql по security_remediation_state: возвращает права anon и
-- authenticated на таблицы и права по умолчанию ровно такими, какими они были, затем удаляет служебную таблицу.
-- Запускать той же ролью (владельцем таблиц), одной транзакцией: psql -1 -v ON_ERROR_STOP=1 -f …
-- Не восстанавливается: WITH GRANT OPTION (у ролей API в Supabase его нет) и права на отдельные колонки
-- (предложение предупреждает о них в NOTICE). RLS предложение не меняет — откат его тоже не трогает.

DO $$
DECLARE
  s record;
  rel regclass;
  p text;
  r text;
  owner_role text;
BEGIN
  IF to_regclass('public.security_remediation_state') IS NULL THEN
    RAISE NOTICE 'nothing to roll back';
    RETURN;
  END IF;
  FOR s IN SELECT * FROM security_remediation_state ORDER BY kind, object_name LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);
      FOREACH p IN ARRAY CASE WHEN r = 'anon' THEN s.anon_privileges ELSE s.authenticated_privileges END LOOP
        IF s.kind = 'table' THEN
          rel := to_regclass(format('public.%I', s.object_name));
          CONTINUE WHEN rel IS NULL OR s.object_name = 'security_remediation_state';
          EXECUTE format('GRANT %s ON TABLE %s TO %I', p, rel, r);
        ELSE
          owner_role := substring(s.object_name FROM length('default:tables:') + 1);
          EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT %s ON TABLES TO %I',
                         owner_role, p, r);
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

DROP TABLE IF EXISTS security_remediation_state;
