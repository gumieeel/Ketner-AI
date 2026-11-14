/**
 * Общие примеры для правил секретов: тесты кода (secrets.test.ts) и стенд на Postgres
 * (docs/persistence-review/slice-a/secret-parity.mts) проверяют, что код и `platform_contains_secret`
 * дают одинаковый ответ на каждый пример.
 */

export interface SecretCase {
  name: string;
  doc: unknown;
  secret: boolean;
}

export const SECRET_CORPUS: SecretCase[] = [
  // Ложные срабатывания прежней проверки — теперь не секрет.
  {
    name: 'JSON-схема с полем password',
    doc: {
      type: 'object',
      properties: { password: { type: 'string', minLength: 8 } },
      required: ['password'],
    },
    secret: false,
  },
  {
    name: 'текст со словом bearer',
    doc: { note: 'The bearer certificate is valid' },
    secret: false,
  },
  {
    name: 'имя поля в списке полей',
    doc: { fields: ['email', 'password', 'api_key'] },
    secret: false,
  },
  { name: 'пустой пароль', doc: { password: '' }, secret: false },
  { name: 'число токенов', doc: { inputTokens: 1200, maxTokens: '4096' }, secret: false },
  {
    name: 'ссылка на источник авторизации',
    doc: { authorization: 'legacy_bot_enablement:sol-1' },
    secret: false,
  },
  { name: 'отметка об очистке', doc: { accessToken: '[redacted:secret_field]' }, secret: false },
  { name: 'отметка об очистке без причины', doc: { token: '[redacted]' }, secret: false },
  {
    name: 'обычная выдержка ответа',
    doc: { excerpt: 'Доставка по Алматы — 1 500 ₸.' },
    secret: false,
  },
  { name: 'короткий sk- в тексте', doc: { note: 'see sk-live-docs' }, secret: false },
  { name: 'id запуска с двоеточием', doc: { runId: 'ketner:exec_1:send' }, secret: false },

  // Пропуски прежней проверки — теперь секрет.
  { name: 'accessToken в camelCase', doc: { accessToken: 'ya29.a0AfH6SMBx' }, secret: true },
  { name: 'token со значением sk-live', doc: { token: 'sk-live-...' }, secret: true },
  {
    name: 'refresh_token во вложенном объекте',
    doc: { oauth: { refresh_token: '1//0gAbCdEf' } },
    secret: true,
  },
  { name: 'clientSecret', doc: { clientSecret: 'GOCSPX-abcdef' }, secret: true },
  { name: 'oauthTokenData строкой', doc: { oauthTokenData: '{"access_token":"x"}' }, secret: true },
  {
    name: 'пароль в массиве объектов',
    doc: { users: [{ name: 'a', password: 'hunter22' }] },
    secret: true,
  },
  {
    name: 'заголовок Authorization',
    doc: { headers: { Authorization: 'Bearer abcdefgh12345678' } },
    secret: true,
  },
  {
    name: 'ключ OpenAI-формата в тексте',
    doc: { error: 'invalid key sk-proj-AbCdEf0123456789XyZ0' },
    secret: true,
  },
  { name: 'ключ Stripe', doc: { note: 'sk_live_51HabcdefGHIJ' }, secret: true },
  { name: 'токен GitHub', doc: { log: 'ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789' }, secret: true },
  {
    name: 'JWT',
    doc: {
      value:
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    },
    secret: true,
  },
  { name: 'приватный ключ', doc: { pem: '-----BEGIN RSA PRIVATE KEY-----\nMIIE' }, secret: true },
  {
    name: 'токен бота Telegram',
    doc: { text: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw1' },
    secret: true,
  },
  {
    name: 'Bearer с токеном в тексте',
    doc: { error: 'request failed: Bearer abcDEF1234567890ghijkl' },
    secret: true,
  },
  { name: 'ключ AWS', doc: { k: 'AKIAIOSFODNN7EXAMPLE' }, secret: true },
  { name: 'cookie', doc: { cookie: 'session=abc123def' }, secret: true },
];
