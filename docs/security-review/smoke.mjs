// Проверка работающего сервера после исправления прав: вход, запись и чтение через API.
// Запуск: node smoke.mjs http://127.0.0.1:<порт>
const base = process.argv[2];
const results = [];
const call = async (method, path, body, token) => {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* пустой ответ */
  }
  return { status: res.status, json };
};
const check = (name, ok, detail) => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);

const health = await call('GET', '/api/health');
check('GET /api/health', health.status === 200, health.status);
const login = await call('POST', '/api/auth/demo');
check('demo login (reads users)', login.status === 200 && login.json?.token, login.status);
const token = login.json?.token;
const created = await call(
  'POST',
  '/api/solutions',
  { name: 'Security smoke', language: 'ru' },
  token,
);
const id = created.json?.solution?.id ?? created.json?.id;
check(
  'create solution (writes solutions, solution_versions, solution_test_cases)',
  created.status === 201 || created.status === 200,
  `${created.status} id=${id}`,
);
const list = await call('GET', '/api/solutions', undefined, token);
check('list solutions (reads)', list.status === 200, list.status);
const one = await call('GET', `/api/solutions/${id}`, undefined, token);
check('get solution', one.status === 200, one.status);
const conv = await call('POST', '/api/conversations', { title: 'smoke' }, token);
check(
  'create conversation (writes conversations)',
  conv.status === 200 || conv.status === 201,
  conv.status,
);
const del = await call('DELETE', `/api/solutions/${id}`, undefined, token);
check('delete solution (cascade delete)', del.status === 200 || del.status === 204, del.status);
for (const r of results) console.log(r);
console.log(
  `passed=${results.filter((r) => r.startsWith('PASS')).length} failed=${results.filter((r) => r.startsWith('FAIL')).length}`,
);
process.exitCode = results.every((r) => r.startsWith('PASS')) ? 0 : 1;
