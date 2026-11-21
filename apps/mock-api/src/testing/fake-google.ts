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
    grant: {},
    sheetStatus: 200,
    revokeStatus: 200,
    tokenRequests: [],
    revoked: [],
    sheetsCreated: [],
    fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        fake.tokenRequests.push(new URLSearchParams(String(init?.body ?? '')));
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
      if (url.startsWith('https://sheets.googleapis.com/v4/spreadsheets')) {
        const headers = new Headers(init?.headers);
        fake.sheetsCreated.push({
          authorization: headers.get('authorization'),
          body: JSON.parse(String(init?.body ?? '{}')),
        });
        if (fake.sheetStatus !== 200) return new Response('{}', { status: fake.sheetStatus });
        sheetCounter += 1;
        const id = `sheet${sheetCounter}-AbCdEfGhIjKlMn`;
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
