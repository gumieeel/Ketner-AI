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

// --- Запись заявки (этап F, шаг 4; docs/STAGE_F_SHEETS.md, разделы 4–5) ----------------------

const SHEETS_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
/** Колонки A:G листа «Заявки». */
export const LEAD_SHEET_RANGE = `${LEAD_SHEET_TITLE}!A:G`;
/** Колонка «ID заявки» — для сверки неясного исхода. */
export const LEAD_ID_RANGE = `${LEAD_SHEET_TITLE}!G:G`;
/** Предел ячейки Google Таблиц — 50 000 символов. */
export const CELL_LIMIT = 50_000;

export interface LeadRowInput {
  createdAt: string;
  botName: string;
  name: string;
  contact: string;
  question: string;
  dialogUrl: string;
  leadId: string;
}

/** `2026-11-21 17:05 UTC`: часовой пояс владельца неизвестен, поэтому явно UTC. */
export function formatLeadDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function cell(value: string): string {
  return value.length > CELL_LIMIT ? `${value.slice(0, CELL_LIMIT - 1)}…` : value;
}

/**
 * Строка таблицы в порядке колонок. Значения уходят как есть: запись идёт с `valueInputOption=RAW`,
 * поэтому `=IMPORTXML(…)`, `+cmd|…`, `@…` от посетителя остаются текстом, а не формулой.
 */
export function leadRow(input: LeadRowInput): string[] {
  return [
    formatLeadDate(input.createdAt),
    input.botName,
    input.name,
    input.contact,
    input.question,
    input.dialogUrl,
    input.leadId,
  ].map(cell);
}

function sheetHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

export type AppendOutcome =
  | { kind: 'ok'; updatedRange: string }
  /** Google ответил ошибкой: строка не записана. */
  | { kind: 'rejected'; status: number; code: string }
  /** Запрос ушёл, ответа нет (таймаут, обрыв): строка могла записаться. */
  | { kind: 'unknown' };

/** `spreadsheets.values.append`, `RAW`, `INSERT_ROWS` — одна строка в конец листа «Заявки». */
export async function appendLeadRow(
  accessToken: string,
  spreadsheetId: string,
  row: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<AppendOutcome> {
  const url = new URL(
    `${SHEETS_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(LEAD_SHEET_RANGE)}:append`,
  );
  url.searchParams.set('valueInputOption', 'RAW');
  url.searchParams.set('insertDataOption', 'INSERT_ROWS');
  url.searchParams.set('includeValuesInResponse', 'false');
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      method: 'POST',
      headers: sheetHeaders(accessToken),
      body: JSON.stringify({ range: LEAD_SHEET_RANGE, majorDimension: 'ROWS', values: [row] }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { kind: 'unknown' };
  }
  if (!response.ok) {
    return { kind: 'rejected', status: response.status, code: googleErrorCode(response.status) };
  }
  const body = (await response.json().catch(() => ({}))) as {
    updates?: { updatedRange?: unknown };
  };
  const range = typeof body.updates?.updatedRange === 'string' ? body.updates.updatedRange : '';
  return { kind: 'ok', updatedRange: range.slice(0, 200) };
}

/** Сверка: есть ли `leadId` в колонке «ID заявки». Сбой — `GoogleSheetsError`. */
export async function sheetHasLead(
  accessToken: string,
  spreadsheetId: string,
  leadId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const url = new URL(
    `${SHEETS_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(LEAD_ID_RANGE)}`,
  );
  url.searchParams.set('majorDimension', 'COLUMNS');
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      headers: sheetHeaders(accessToken),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new GoogleSheetsError('unavailable');
  }
  if (!response.ok) throw new GoogleSheetsError(googleErrorCode(response.status));
  const body = (await response.json().catch(() => ({}))) as { values?: unknown };
  const columns = Array.isArray(body.values) ? body.values : [];
  return columns.some((column) => Array.isArray(column) && column.includes(leadId));
}

/**
 * В корзине ли таблица (Drive `files.get?fields=trashed`; `drive.file` даёт метаданные файлов
 * приложения). Sheets API пишет и в файл из корзины, поэтому это проверяется отдельно.
 */
export async function spreadsheetTrashed(
  accessToken: string,
  spreadsheetId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  let response: Response;
  try {
    response = await fetchImpl(
      `${DRIVE_FILES_URL}/${encodeURIComponent(spreadsheetId)}?fields=trashed`,
      { headers: sheetHeaders(accessToken), signal: AbortSignal.timeout(15_000) },
    );
  } catch {
    throw new GoogleSheetsError('unavailable');
  }
  if (!response.ok) throw new GoogleSheetsError(googleErrorCode(response.status));
  const body = (await response.json().catch(() => ({}))) as { trashed?: unknown };
  return body.trashed === true;
}
