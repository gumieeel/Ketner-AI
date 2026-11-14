-- Откат docs/SECURITY_REMEDIATION_PROPOSAL.sql по security_remediation_state: возвращает права anon,
-- authenticated и PUBLIC на таблицы и функции и права по умолчанию ровно такими, какими они были, затем
-- удаляет служебную таблицу. Запускать той же ролью (владельцем), одной транзакцией: psql -1 -v ON_ERROR_STOP=1 -f …
-- Не восстанавливается: WITH GRANT OPTION (у ролей API в Supabase его нет) и права на отдельные колонки
-- (предложение предупреждает о них в NOTICE). RLS предложение не меняет — откат его тоже не трогает.
-- Функция, у которой до исправления права были встроенными (proacl = NULL), после отката получает те же
-- права, записанные явно (PostgreSQL не умеет вернуть NULL): по смыслу это то же самое.

DO $$
DECLARE
  s record;
  rel regclass;
  fn regprocedure;
  p text;
  r text;
  owner_role text;
BEGIN
  IF to_regclass('public.security_remediation_state') IS NULL THEN
    RAISE NOTICE 'nothing to roll back';
    RETURN;
  END IF;
  FOR s IN SELECT * FROM security_remediation_state ORDER BY kind, object_name LOOP
    IF s.kind = 'function' THEN
      fn := to_regprocedure('public.' || s.object_name);
      CONTINUE WHEN fn IS NULL;
      IF 'EXECUTE' = ANY (s.public_privileges) THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', fn);
      END IF;
    ELSIF s.object_name LIKE 'default:functions-global:%' THEN
      owner_role := substring(s.object_name FROM length('default:functions-global:') + 1);
      IF 'EXECUTE' = ANY (s.public_privileges) THEN
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I GRANT EXECUTE ON FUNCTIONS TO PUBLIC', owner_role);
      END IF;
    END IF;
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);
      FOREACH p IN ARRAY CASE WHEN r = 'anon' THEN s.anon_privileges ELSE s.authenticated_privileges END LOOP
        IF s.kind = 'table' THEN
          rel := to_regclass(format('public.%I', s.object_name));
          CONTINUE WHEN rel IS NULL OR s.object_name = 'security_remediation_state';
          EXECUTE format('GRANT %s ON TABLE %s TO %I', p, rel, r);
        ELSIF s.kind = 'function' THEN
          CONTINUE WHEN fn IS NULL;
          EXECUTE format('GRANT %s ON FUNCTION %s TO %I', p, fn, r);
        ELSIF s.object_name LIKE 'default:tables:%' THEN
          owner_role := substring(s.object_name FROM length('default:tables:') + 1);
          EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT %s ON TABLES TO %I',
                         owner_role, p, r);
        ELSIF s.object_name LIKE 'default:sequences:%' THEN
          owner_role := substring(s.object_name FROM length('default:sequences:') + 1);
          EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT %s ON SEQUENCES TO %I',
                         owner_role, p, r);
        ELSIF s.object_name LIKE 'default:functions:%' THEN
          owner_role := substring(s.object_name FROM length('default:functions:') + 1);
          EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT %s ON FUNCTIONS TO %I',
                         owner_role, p, r);
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

DROP TABLE IF EXISTS security_remediation_state;
