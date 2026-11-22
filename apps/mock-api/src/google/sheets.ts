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

/** Ширина колонок в пикселях, по порядку `LEAD_SHEET_COLUMNS`: вопрос — самый широкий. */
export const LEAD_SHEET_WIDTHS = [140, 150, 150, 180, 380, 240, 290] as const;

/** Часовой пояс в формате IANA (`Asia/Qyzylorda`), который знает Intl; иначе — нет. */
export function validTimeZone(value: unknown): string | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_+\-/]{1,64}$/.test(value)) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

/** Заголовки: «Дата» — в часовом поясе владельца, если он известен, иначе «Дата (UTC)». */
export function leadSheetHeaders(timeZone?: string | null): string[] {
  return [validTimeZone(timeZone) ? 'Дата' : 'Дата (UTC)', ...LEAD_SHEET_COLUMNS.slice(1)];
}

/**
 * Тело запроса `spreadsheets.create`: лист «Заявки», строка заголовков жирным, первая строка
 * закреплена, ширина колонок; часовой пояс таблицы — пояс владельца, если он известен.
 */
export function leadSpreadsheetBody(timeZone?: string | null): Record<string, unknown> {
  const zone = validTimeZone(timeZone);
  return {
    properties: { title: LEAD_SPREADSHEET_TITLE, ...(zone ? { timeZone: zone } : {}) },
    sheets: [
      {
        properties: { title: LEAD_SHEET_TITLE, gridProperties: { frozenRowCount: 1 } },
        data: [
          {
            startRow: 0,
            startColumn: 0,
            rowData: [
              {
                values: leadSheetHeaders(zone).map((title) => ({
                  userEnteredValue: { stringValue: title },
                  userEnteredFormat: { textFormat: { bold: true } },
                })),
              },
            ],
            columnMetadata: LEAD_SHEET_WIDTHS.map((pixelSize) => ({ pixelSize })),
          },
        ],
      },
    ],
  };
}

export async function createLeadSpreadsheet(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
  timeZone?: string | null,
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
      body: JSON.stringify(leadSpreadsheetBody(timeZone)),
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
  /** Часовой пояс владельца (IANA); нет — дата в UTC с пометкой. */
  timeZone?: string | null;
}

/**
 * Дата заявки: `2026-11-22 11:35` в поясе владельца, если он известен; иначе `2026-11-22 06:35 UTC`
 * (и колонка таблицы тогда называется «Дата (UTC)»).
 */
export function formatLeadDate(iso: string, timeZone?: string | null): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const zone = validTimeZone(timeZone);
  if (!zone) return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function cell(value: string): string {
  return value.length > CELL_LIMIT ? `${value.slice(0, CELL_LIMIT - 1)}…` : value;
}

/** Начала, с которых Excel и LibreOffice читают ячейку CSV как формулу (OWASP «CSV injection»). */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Значение от посетителя: если оно начинается как формула — с апострофом впереди, кроме значений,
 * которые целиком — номер телефона или ник (`isPhoneNumber`, `isHandle`). В самой Google
 * Таблице запись и так идёт с `RAW` (формулой ничего не станет), апостроф нужен для выгрузки: CSV,
 * открытый в Excel, иначе выполнил бы `=HYPERLINK(…)`, `+cmd|…`, `@SUM(…)`.
 */
export function neutralizeFormula(value: string): string {
  if (!FORMULA_START.test(value) || isPhoneNumber(value) || isHandle(value)) return value;
  return `'${value}`;
}

/** Только телефон: необязательный «+» впереди, дальше цифры, пробелы, скобки, точки и дефисы. */
const PHONE = /^\+?[0-9 ().-]+$/;

/**
 * Значение — только номер телефона (не меньше 5 цифр). Такой строке апостроф не нужен: Excel
 * прочитает её в худшем случае как число или выражение без функций, вызвать ничего не может, а
 * апостроф был бы виден в таблице ('+7 …).
 */
export function isPhoneNumber(value: string): boolean {
  return PHONE.test(value) && (value.match(/[0-9]/g)?.length ?? 0) >= 5;
}

/** Только ник: «@» и 3–32 латинские буквы, цифры, подчёркивания или точки (как в Telegram). */
const HANDLE = /^@[A-Za-z0-9_.]{3,32}$/;

export function isHandle(value: string): boolean {
  return HANDLE.test(value);
}

/**
 * Строка таблицы в порядке колонок. Запись — с `valueInputOption=RAW`; поля посетителя (имя,
 * контакт, вопрос) дополнительно обезврежены для выгрузки в CSV (`neutralizeFormula`).
 */
export function leadRow(input: LeadRowInput): string[] {
  return [
    formatLeadDate(input.createdAt, input.timeZone),
    input.botName,
    neutralizeFormula(input.name),
    neutralizeFormula(input.contact),
    neutralizeFormula(input.question),
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
