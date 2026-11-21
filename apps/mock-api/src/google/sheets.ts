/**
 * Таблица заявок в Диске владельца (docs/STAGE_F_SHEETS.md, раздел 4). Создание —
 * `spreadsheets.create`, его разрешает `drive.file`. Запись строк — этап F, шаг 4.
 */

export const LEAD_SPREADSHEET_TITLE = 'Заявки Ketner';
export const LEAD_SHEET_TITLE = 'Заявки';
/** Порядок колонок; «ID заявки» — последней, по ней сверяется неясный исход записи. */
export const LEAD_SHEET_COLUMNS = [
  'Дата',
  'Бот',
  'Имя',
  'Контакт',
  'Вопрос',
  'Диалог',
  'ID заявки',
] as const;

const CREATE_URL = 'https://sheets.googleapis.com/v4/spreadsheets';

/** Код сбоя Google для `last_error_code` (только `[a-z0-9_]`, без текста ответа). */
export function googleErrorCode(status: number): string {
  if (status === 401) return 'invalid_grant';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'quota';
  if (status >= 500) return 'http_5xx';
  return 'http_4xx';
}

export class GoogleSheetsError extends Error {
  constructor(readonly code: string) {
    super(`Google Sheets: ${code}`);
    this.name = 'GoogleSheetsError';
  }
}

/** Тело запроса `spreadsheets.create`: лист «Заявки», строка заголовков, первая строка закреплена. */
export function leadSpreadsheetBody(): Record<string, unknown> {
  return {
    properties: { title: LEAD_SPREADSHEET_TITLE },
    sheets: [
      {
        properties: { title: LEAD_SHEET_TITLE, gridProperties: { frozenRowCount: 1 } },
        data: [
          {
            startRow: 0,
            startColumn: 0,
            rowData: [
              {
                values: LEAD_SHEET_COLUMNS.map((title) => ({
                  userEnteredValue: { stringValue: title },
                })),
              },
            ],
          },
        ],
      },
    ],
  };
}

export async function createLeadSpreadsheet(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: string; url: string }> {
  let response: Response;
  try {
    response = await fetchImpl(`${CREATE_URL}?fields=spreadsheetId,spreadsheetUrl`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(leadSpreadsheetBody()),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new GoogleSheetsError('unavailable');
  }
  if (!response.ok) throw new GoogleSheetsError(googleErrorCode(response.status));
  const body = (await response.json().catch(() => ({}))) as {
    spreadsheetId?: unknown;
    spreadsheetUrl?: unknown;
  };
  if (
    typeof body.spreadsheetId !== 'string' ||
    !/^[A-Za-z0-9_-]{10,200}$/.test(body.spreadsheetId) ||
    typeof body.spreadsheetUrl !== 'string' ||
    !body.spreadsheetUrl.startsWith('https://docs.google.com/')
  ) {
    throw new GoogleSheetsError('bad_response');
  }
  return { id: body.spreadsheetId, url: body.spreadsheetUrl };
}
