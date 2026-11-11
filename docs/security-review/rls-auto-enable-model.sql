-- МОДЕЛЬ событийного триггера production `rls_auto_enable()` (R3, 11.11.2026: функция в public,
-- SECURITY DEFINER, событийный триггер): включает RLS на каждой новой таблице схемы public.
-- Текст настоящей функции в production не проверен — здесь поведение, описанное владельцем.
-- Создаётся суперпользователем одноразовой базы (событийные триггеры может создавать только он).
CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
  LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN
    SELECT * FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type = 'table' AND schema_name = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', obj.object_identity);
  END LOOP;
END
$$;
CREATE EVENT TRIGGER rls_auto_enable ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.rls_auto_enable();
