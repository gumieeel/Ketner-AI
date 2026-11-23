/**
 * Поддельный Google для тестов этапа F: token endpoint, отзыв доступа и создание таблицы — на
 * подменённом `fetch`, без сети.
 */

export const FAKE_GOOGLE_SETTINGS = {
  clientId: 'client-123.apps.googleusercontent.com',
  clientSecret: 'client-secret',
  redirectUri: 'https://ketner.org/api/integrations/google/callback',
};

export const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';
export const USERINFO_EMAIL = 'https://www.googleapis.com/auth/userinfo.email';

export function fakeIdToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part(claims)}.signature`;
}

export function idTokenClaims(overrides: Record<string, unknown> = {}, now = Date.now()) {
  return {
    iss: 'https://accounts.google.com',
    aud: FAKE_GOOGLE_SETTINGS.clientId,
    sub: '1234567890',
    email: 'owner@example.com',
    email_verified: true,
    exp: Math.floor(now / 1000) + 3600,
    ...overrides,
  };
}

export interface FakeGoogleGrant {
  sub?: string;
  email?: string;
  refreshToken?: string;
  scope?: string;
}

export interface FakeGoogle {
  fetchImpl: typeof fetch;
  /** Обновление access-токена: `invalid_grant` — доступ отозван. */
  refreshError: string | null;
  refreshCount: number;
  /** Ответ на запись строки: число — статус, `'throw'` — обрыв после отправки. */
  appendStatus: number | 'throw';
  /** Строки, дописанные в таблицы: `spreadsheetId → строки`. */
  rows: Map<string, string[][]>;
  appendRequests: Array<{ url: string; authorization: string | null; body: unknown }>;
  /** Записать строку, но ответить обрывом (неясный исход, строка есть). */
  appendWritesBeforeThrow: boolean;
  /** Ответ на чтение колонки «ID заявки». */
  readStatus: number;
  trashed: boolean;
  driveStatus: number;
  /** Сколько запросов к Drive (`files.get`): проверка корзины и прав на файл. */
  driveRequests: number;
  /**
   * Файлы, которые Google не показывает Ketner (404 в Drive и Sheets): так после отзыва доступа
   * `drive.file` перестаёт покрывать таблицу, созданную раньше.
   */
  noAccess: Set<string>;
  /**
   * Файлы в Диске владельца: тип, корзина и строка заголовков листа «Заявки» (`null` — листа нет).
   * Созданные таблицы попадают сюда сами, с заголовком из запроса.
   */
  files: Map<string, { mimeType?: string; trashed?: boolean; header?: string[] | null }>;
  /** Следующий ответ token endpoint. */
  grant: FakeGoogleGrant;
  /** Статус ответа на создание таблицы (200 — создать). */
  sheetStatus: number;
  /** Статус ответа на отзыв. */
  revokeStatus: number;
  tokenRequests: URLSearchParams[];
  revoked: string[];
  sheetsCreated: Array<{ authorization: string | null; body: unknown }>;
}

export function createFakeGoogle(): FakeGoogle {
  let sheetCounter = 0;
  const fake: FakeGoogle = {
    refreshError: null,
    refreshCount: 0,
    appendStatus: 200,
    rows: new Map(),
    appendRequests: [],
    appendWritesBeforeThrow: false,
    readStatus: 200,
    trashed: false,
    driveStatus: 200,
    driveRequests: 0,
    noAccess: new Set(),
    files: new Map(),
    grant: {},
    sheetStatus: 200,
    revokeStatus: 200,
    tokenRequests: [],
    revoked: [],
    sheetsCreated: [],
    fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        const params = new URLSearchParams(String(init?.body ?? ''));
        if (params.get('grant_type') === 'refresh_token') {
          fake.refreshCount += 1;
          if (fake.refreshError) {
            return Response.json({ error: fake.refreshError }, { status: 400 });
          }
          return Response.json({
            access_token: `ya29.refreshed-${fake.refreshCount}`,
            expires_in: 3599,
          });
        }
        fake.tokenRequests.push(params);
        const grant = fake.grant;
        return Response.json({
          access_token: 'ya29.fake-access',
          refresh_token: grant.refreshToken ?? '1//fake-refresh',
          scope: grant.scope ?? `openid ${USERINFO_EMAIL} ${DRIVE_FILE}`,
          id_token: fakeIdToken(
            idTokenClaims({
              ...(grant.sub ? { sub: grant.sub } : {}),
              ...(grant.email ? { email: grant.email } : {}),
            }),
          ),
          expires_in: 3599,
          token_type: 'Bearer',
        });
      }
      if (url === 'https://oauth2.googleapis.com/revoke') {
        fake.revoked.push(new URLSearchParams(String(init?.body ?? '')).get('token') ?? '');
        return new Response('', { status: fake.revokeStatus });
      }
      const values =
        /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/([^/]+)\/values\/([^?:]+)(:append)?/.exec(
          url,
        );
      if (values) {
        const spreadsheetId = decodeURIComponent(values[1]!);
        if (fake.noAccess.has(spreadsheetId)) return new Response('{}', { status: 404 });
        const headers = new Headers(init?.headers);
        if (values[3]) {
          const body = JSON.parse(String(init?.body ?? '{}')) as { values: string[][] };
          fake.appendRequests.push({ url, authorization: headers.get('authorization'), body });
          const write = () => {
            const list = fake.rows.get(spreadsheetId) ?? [];
            list.push(...body.values);
            fake.rows.set(spreadsheetId, list);
            return list.length;
          };
          if (fake.appendStatus === 'throw') {
            if (fake.appendWritesBeforeThrow) write();
            throw new TypeError('fetch failed');
          }
          if (fake.appendStatus !== 200) return new Response('{}', { status: fake.appendStatus });
          const n = write() + 1;
          return Response.json({
            updates: { updatedRange: `'Заявки'!A${n}:G${n}`, updatedRows: 1 },
          });
        }
        if (fake.readStatus !== 200) return new Response('{}', { status: fake.readStatus });
        if (decodeURIComponent(values[2]!) === 'Заявки!A1:G1') {
          const header = fake.files.get(spreadsheetId)?.header;
          if (header === null) return new Response('{}', { status: 400 });
          return Response.json({ values: header ? [header] : [] });
        }
        const ids = (fake.rows.get(spreadsheetId) ?? []).map((row) => row[6] ?? '');
        return Response.json({ values: [['ID заявки', ...ids]] });
      }
      if (url.startsWith('https://www.googleapis.com/drive/v3/files/')) {
        fake.driveRequests += 1;
        const fileId = decodeURIComponent(
          url.slice('https://www.googleapis.com/drive/v3/files/'.length).split('?')[0]!,
        );
        if (fake.noAccess.has(fileId)) return new Response('{}', { status: 404 });
        if (fake.driveStatus !== 200) return new Response('{}', { status: fake.driveStatus });
        const file = fake.files.get(fileId);
        return Response.json({
          trashed: file?.trashed ?? fake.trashed,
          mimeType: file?.mimeType ?? 'application/vnd.google-apps.spreadsheet',
        });
      }
      if (url.startsWith('https://sheets.googleapis.com/v4/spreadsheets')) {
        const headers = new Headers(init?.headers);
        fake.sheetsCreated.push({
          authorization: headers.get('authorization'),
          body: JSON.parse(String(init?.body ?? '{}')),
        });
        if (fake.sheetStatus !== 200) return new Response('{}', { status: fake.sheetStatus });
        sheetCounter += 1;
        const id = `sheet${sheetCounter}-AbCdEfGhIjKlMn`;
        const created = JSON.parse(String(init?.body ?? '{}')) as {
          sheets?: Array<{
            data?: Array<{
              rowData?: Array<{ values?: Array<{ userEnteredValue?: { stringValue?: string } }> }>;
            }>;
          }>;
        };
        fake.files.set(id, {
          header: (created.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values ?? []).map(
            (cell) => cell.userEnteredValue?.stringValue ?? '',
          ),
        });
        return Response.json({
          spreadsheetId: id,
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`,
        });
      }
      throw new Error(`поддельный Google: неожиданный адрес ${url}`);
    }) as typeof fetch,
  };
  return fake;
}
