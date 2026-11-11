-- Данные «как в production до миграции»: решения, версии, бот, диалог, сообщения, заявка.
-- Запускается после 0001–0012 и до предложения; снимок нужен проверке раздела 0.
\set ON_ERROR_STOP 1
INSERT INTO solutions (id, user_id, type, status, name, current_version, active_version, template, bot, slug)
  VALUES ('sol_a', 'user_a', 'customer_bot', 'active', 'Керамика', 2, 2, 'customer_bot',
          '{"slug":"keramika","greeting":"Здравствуйте","quickReplies":["Цены"],"dailyCapCredits":1000,"corrections":[]}', 'keramika'),
         ('sol_b', 'user_b', 'customer_bot', 'paused', 'Цветы', 1, 1, 'customer_bot',
          '{"slug":"cvety","greeting":"","quickReplies":[],"dailyCapCredits":50,"corrections":[]}', 'cvety'),
         ('sol_c', 'user_a', 'assistant', 'draft', 'Помощник', 1, NULL, 'personal_assistant', NULL, NULL);
INSERT INTO solution_versions (solution_id, number, config)
  VALUES ('sol_a', 1, '{"name":"Керамика","purpose":"","instructions":"v1","tone":"friendly","knowledge":"","examples":[],"restrictions":[],"language":"ru"}'),
         ('sol_a', 2, '{"name":"Керамика","purpose":"","instructions":"v2","tone":"friendly","knowledge":"","examples":[],"restrictions":[],"language":"ru"}'),
         ('sol_b', 1, '{"name":"Цветы","purpose":"","instructions":"","tone":"formal","knowledge":"","examples":[],"restrictions":[],"language":"ru"}'),
         ('sol_c', 1, '{"name":"Помощник","purpose":"","instructions":"","tone":"concise","knowledge":"","examples":[],"restrictions":[],"language":"en"}');
INSERT INTO bot_conversations (id, solution_id, user_id, visitor_id, message_count) VALUES ('conv_1', 'sol_a', 'user_a', 'v_abcdefabcdef', 2);
INSERT INTO bot_messages (id, conversation_id, solution_id, user_id, role, content, credits_usd, status)
  VALUES ('m1', 'conv_1', 'sol_a', 'user_a', 'user', 'Сколько стоит?', 0, 'complete'),
         ('m2', 'conv_1', 'sol_a', 'user_a', 'assistant', '12 000 ₸', 0.004, 'complete');
INSERT INTO bot_leads (id, solution_id, user_id, conversation_id, name, contact, question, status)
  VALUES ('l1', 'sol_a', 'user_a', 'conv_1', 'Алия', '+7 700 000 00 00', 'Доставка?', 'new');

CREATE TABLE seed_snapshot (name text PRIMARY KEY, checksum text NOT NULL);
INSERT INTO seed_snapshot VALUES
  ('solutions', (SELECT md5(string_agg(row_to_json(s)::text, ',' ORDER BY id)) FROM
     (SELECT id, user_id, type, status, name, current_version, active_version, bot, slug, template FROM solutions) s)),
  ('solution_versions', (SELECT md5(string_agg(solution_id || number || config::text, ',' ORDER BY solution_id, number)) FROM solution_versions));
