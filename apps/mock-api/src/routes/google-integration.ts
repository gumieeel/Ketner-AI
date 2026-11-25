import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { sendError } from '../middleware/errors.js';
import { googleSheetsEnabledFor, sendFeatureUnavailable } from '../product-switches.js';
import { fallbackReturnTo, safeReturnTo } from '../github/oauth.js';
import type { GoogleConnection, GoogleConnectionStore } from '../google/connection-store.js';
import {
  GoogleOAuthError,
  createCodeVerifier,
  createGoogleState,
  exchangeGoogleCode,
  googleAuthorizeUrl,
  googleDiagnostics,
  googleOAuthSettings,
  googlePickerConfig,
  readGoogleState,
  revokeGoogleToken,
  withFragment,
  type GoogleOAuthSettings,
  type GooglePickerConfig,
} from '../google/oauth.js';
import {
  GoogleSheetsError,
  checkLeadSpreadsheet,
  createLeadSpreadsheet,
  validSpreadsheetId,
} from '../google/sheets.js';
import type { GoogleVerifierStore } from '../google/verifier-store.js';
import type { PickSheetResult, SheetsDelivery } from '../google/delivery.js';
import type { GooglePrefsStore } from '../google/prefs.js';
import type { BuilderStore } from '../builder/store.js';
import { checkServiceConnect } from '../billing/external-services.js';
import { tierById, type TierId } from '../services/tiers.js';

export interface GoogleIntegrationRouterDeps {
  store: GoogleConnectionStore;
  verifiers: GoogleVerifierStore;
  /** Подмена настроек OAuth в тестах; по умолчанию — из переменных окружения. */
  settings?: () => GoogleOAuthSettings | null;
  /** Ключ и номер проекта для Google Picker; по умолчанию — из переменных окружения. */
  picker?: () => GooglePickerConfig | null;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  /** Доставка заявок (шаг 4): отметки у заявок, повтор, «дописать пропущенные», новая таблица. */
  delivery?: SheetsDelivery;
  /** Заявки бота владельца (для отметок в кабинете). */
  leads?: () => Pick<BuilderStore, 'listLeads'> | null;
  /** Часовой пояс владельца: браузер присылает его при подключении и открытии кабинета. */
  prefs?: GooglePrefsStore;
  /**
   * Тариф аккаунта (billing/external-services.ts): подключение внешнего сервиса — только при
   * активном тарифе со свободным местом. Нет или `enforced()` ложно — проверок нет.
   */
  tiers?: {
    enforced: () => boolean;
    tierOf: (userId: string) => TierId | null;
    /** Другие подключённые внешние сервисы аккаунта (CRM, календарь — пока нет). */
    otherServices?: (userId: string) => number;
  };
}

/** Почему выбранный файл не подошёл — текст для владельца. */
const PICK_REFUSALS: Record<
  Exclude<PickSheetResult['result'], 'ok'>,
  { status: number; code: string; message: string }
> = {
  not_spreadsheet: {
    status: 422,
    code: 'sheet_not_spreadsheet',
    message: 'Это не Google Таблица. Выберите таблицу «Заявки Ketner».',
  },
  wrong_header: {
    status: 422,
    code: 'sheet_wrong_header',
    message:
      'В этой таблице нет листа «Заявки» с колонками Ketner (Дата, Бот, Имя, Контакт, Вопрос, Диалог, ID заявки). Выберите таблицу «Заявки Ketner», которую создал Ketner.',
  },
  trashed: {
    status: 422,
    code: 'sheet_trashed',
    message: 'Эта таблица в корзине Google Диска. Восстановите её и выберите снова.',
  },
  no_access: {
    status: 422,
    code: 'sheet_no_access',
    message: 'Google не дал Ketner доступ к этому файлу. Выберите таблицу ещё раз в окне Google.',
  },
  not_connected: {
    status: 409,
    code: 'google_not_connected',
    message: 'Сначала подключите Google Таблицу.',
  },
  reconnect_required: {
    status: 409,
    code: 'google_reconnect_required',
    message: 'Доступ к Google отозван. Подключите таблицу снова.',
  },
  unavailable: {
    status: 502,
    code: 'google_unavailable',
    message: 'Google не ответил. Попробуйте ещё раз через минуту.',
  },
};

/** Что видит сайт: без токенов и без `sub`. */
function publicStatus(connection: GoogleConnection | undefined) {
  return {
    connected: Boolean(connection && connection.status !== 'disconnected'),
    status: connection?.status ?? null,
    email: connection?.googleEmail ?? null,
    spreadsheetUrl: connection?.spreadsheetUrl ?? null,
    lastErrorCode: connection?.lastErrorCode ?? null,
    connectedAt: connection?.connectedAt ?? null,
  };
}

/**
 * Подключение Google Таблицы (этап F, шаг 3; docs/STAGE_F_SHEETS.md, раздел 3).
 *
 * Поток как у GitHub (routes/github.ts): сессия Ketner — это Bearer-токен сайта, на переходе от
 * Google её нет. Поэтому колбэк не обменивает код, а возвращает его сайту во фрагменте адреса, и
 * обмен делает `POST /confirm` в той же сессии, что начала подключение.
 *
 * Выключено, пока не включён переключатель `googleSheets` и не заданы
 * `GOOGLE_SHEETS_CLIENT_ID` / `GOOGLE_SHEETS_CLIENT_SECRET`: все адреса отвечают 503
 * `feature_unavailable`.
 */
export function createGoogleIntegrationRouter({
  store,
  verifiers,
  settings: injected,
  picker: injectedPicker,
  fetchImpl: injectedFetch,
  log: injectedLog,
  delivery,
  leads,
  prefs,
  tiers,
}: GoogleIntegrationRouterDeps): Router {
  const settings = injected ?? googleOAuthSettings;
  const pickerConfig = injectedPicker ?? googlePickerConfig;
  /**
   * Состояние для карточки: подключение, прежняя таблица, которую Ketner больше не может открыть
   * (ссылка), и есть ли кнопка «Выбрать прежнюю таблицу» (настроен Google Picker).
   */
  /** Подключённых внешних сервисов у аккаунта. Сейчас внешний сервис один — Google Таблицы. */
  const googleUsed = (userId: string) => {
    const connection = store.get(userId);
    return connection && connection.status !== 'disconnected' ? 1 : 0;
  };
  const servicesUsed = (userId: string) =>
    googleUsed(userId) + (tiers?.otherServices?.(userId) ?? 0);
  /** Тариф для карточки: активен ли и сколько мест под внешние сервисы; без проверок — null. */
  const tierView = (userId: string) => {
    if (!tiers?.enforced()) return null;
    const tier = tiers.tierOf(userId);
    return {
      active: tier !== null,
      name: tier ? tierById(tier).name : null,
      servicesUsed: servicesUsed(userId),
      servicesLimit: tier ? tierById(tier).externalServices : 0,
    };
  };
  /**
   * Отказ по тарифу (403): нет активного тарифа или нет места под ещё один сервис. `alreadyConnected`
   * — этот сервис уже подключён (повторное согласие, выбор прежней таблицы): место не нужно.
   */
  const refusedByTier = (userId: string, response: Response, alreadyConnected: boolean) => {
    if (!tiers?.enforced()) return false;
    const check = checkServiceConnect({
      tier: tiers.tierOf(userId),
      used: servicesUsed(userId),
      alreadyConnected,
    });
    if (check.ok) return false;
    response.status(403).json({
      error: {
        code: check.code,
        message: check.message,
        details:
          check.code === 'service_limit'
            ? {
                used: check.used,
                limit: check.limit,
                tier: check.tier,
                nextTier: check.nextTier,
                pricingUrl: '/pricing',
              }
            : { pricingUrl: '/pricing' },
      },
    });
    return true;
  };
  /** Этот аккаунт уже подключил Google (не отключал): переподключение места не занимает. */
  const connected = (userId: string) => googleUsed(userId) > 0;
  const cardStatus = (userId: string, connection = store.get(userId)) => {
    const active = Boolean(connection && connection.status !== 'disconnected');
    const lost = active ? (prefs?.lostSheetOf(userId) ?? null) : null;
    return {
      ...publicStatus(connection),
      previousSheetUrl: lost?.url ?? null,
      picker: active && Boolean(delivery) && pickerConfig() !== null,
      tier: tierView(userId),
    };
  };
  const fetchImpl = injectedFetch ?? fetch;
  const log = injectedLog ?? ((message: string) => console.warn(message));
  const router = Router();
  const base = '/integrations/google';

  // Открыто для всех (переключатель) или только для аккаунтов пилота. Колбэк приходит без входа —
  // аккаунт берётся из подписанного state.
  router.use(base, (request: Request, response: Response, next: NextFunction) => {
    const stateUser =
      request.path === '/callback' && typeof request.query.state === 'string'
        ? readGoogleState(request.query.state)?.userId
        : undefined;
    if (!googleSheetsEnabledFor(request.user?.id ?? stateUser) || !settings()) {
      sendFeatureUnavailable(response, 'googleSheets');
      return;
    }
    next();
  });

  router.get(base, requireAuth, async (request: Request, response: Response) => {
    const userId = request.user!.id;
    // Пояс браузера владельца — для дат в таблице (?timeZone=Asia/Qyzylorda).
    prefs?.rememberTimeZone(userId, request.query.timeZone);
    const connection = store.get(userId);
    response.json({
      ...cardStatus(userId, connection),
      // Сколько заявок не записано: кнопка «дописать пропущенные».
      pending: connection && delivery ? await delivery.pending(userId) : 0,
    });
  });

  // Отметки у заявок бота: «в таблице», «записывается», «не записано», «ждёт подключения».
  router.get(`${base}/deliveries`, requireAuth, async (request: Request, response: Response) => {
    const userId = request.user!.id;
    const solutionId = typeof request.query.solutionId === 'string' ? request.query.solutionId : '';
    const source = leads?.();
    if (!solutionId || solutionId.length > 200 || !source || !delivery) {
      response.json({ states: {} });
      return;
    }
    const list = await source.listLeads(userId, solutionId, 200);
    response.json({
      states: await delivery.states(
        userId,
        list.map((lead) => lead.id),
      ),
    });
  });

  router.post(
    `${base}/leads/:leadId/retry`,
    requireAuth,
    async (request: Request, response: Response) => {
      const userId = request.user!.id;
      const leadId = String(request.params.leadId);
      if (!delivery || leadId.length > 200) {
        sendError(response, 404, 'not_found', 'Заявка не найдена');
        return;
      }
      if (refusedByTier(userId, response, true)) return;
      const result = await delivery.retryLead(userId, leadId);
      if (result === 'not_found') {
        sendError(response, 404, 'not_found', 'Заявка не найдена');
        return;
      }
      if (result === 'not_connected') {
        sendError(response, 409, 'google_not_connected', 'Сначала подключите Google Таблицу.');
        return;
      }
      if (result === 'limit') {
        sendError(
          response,
          409,
          'retry_limit',
          'Повторов больше нет. Проверьте таблицу и подключение или перенесите заявку вручную.',
        );
        return;
      }
      response.json({
        result,
        state: (await delivery.states(userId, [leadId]))[leadId] ?? null,
      });
    },
  );

  // «Дописать пропущенные»: все незаписанные заявки, по одной.
  router.post(`${base}/backfill`, requireAuth, async (request: Request, response: Response) => {
    const userId = request.user!.id;
    if (store.get(userId)?.status !== 'connected' || !delivery) {
      sendError(response, 409, 'google_not_connected', 'Сначала подключите Google Таблицу.');
      return;
    }
    if (refusedByTier(userId, response, true)) return;
    const retried = await delivery.backfill(userId);
    response.json({
      retried,
      ...publicStatus(store.get(userId)),
      pending: await delivery.pending(userId),
    });
  });

  // «Проверить снова»: владелец восстановил таблицу из корзины — подключение снова работает с ней.
  router.post(`${base}/recheck`, requireAuth, async (request: Request, response: Response) => {
    const userId = request.user!.id;
    if (!delivery) {
      response.json({ ...publicStatus(store.get(userId)), pending: 0 });
      return;
    }
    const connection = await delivery.recheck(userId);
    response.json({ ...publicStatus(connection), pending: await delivery.pending(userId) });
  });

  // «Создать новую таблицу» после того, как прежняя удалена или в корзине.
  router.post(`${base}/new-sheet`, requireAuth, async (request: Request, response: Response) => {
    const userId = request.user!.id;
    const connection = store.get(userId);
    if (!connection || connection.status === 'disconnected' || !delivery) {
      sendError(response, 409, 'google_not_connected', 'Сначала подключите Google Таблицу.');
      return;
    }
    if (refusedByTier(userId, response, true)) return;
    try {
      prefs?.rememberTimeZone(
        userId,
        (request.body as { timeZone?: unknown } | undefined)?.timeZone,
      );
      response.json(publicStatus(await delivery.newSheet(userId)));
    } catch (error) {
      const code = error instanceof GoogleSheetsError ? error.code : 'sheet_not_created';
      log(`[google] новая таблица для аккаунта ${userId} не создана: ${code}`);
      sendError(
        response,
        code === 'invalid_grant' || code === 'token_unreadable' ? 409 : 502,
        code === 'invalid_grant' || code === 'token_unreadable'
          ? 'google_reconnect_required'
          : 'google_sheet_not_created',
        code === 'invalid_grant' || code === 'token_unreadable'
          ? 'Доступ к Google отозван. Подключите таблицу снова.'
          : 'Google не создал таблицу. Попробуйте ещё раз через минуту.',
      );
    }
  });

  router.post(`${base}/start`, requireAuth, async (request: Request, response: Response) => {
    const oauth = settings()!;
    const body = (request.body ?? {}) as { returnTo?: unknown; timeZone?: unknown };
    prefs?.rememberTimeZone(request.user!.id, body.timeZone);
    // Тариф и место — до перехода в Google: без них подключение не начинается.
    if (refusedByTier(request.user!.id, response, connected(request.user!.id))) return;
    const returnTo = safeReturnTo(body.returnTo) ?? fallbackReturnTo();
    const { state, nonce, expiresAt } = createGoogleState(request.user!.id, returnTo);
    const verifier = createCodeVerifier();
    await verifiers.put({ id: nonce, userId: request.user!.id, verifier, expiresAt });
    response.json({ url: googleAuthorizeUrl(oauth, state, verifier) });
  });

  // Колбэк без входа: код и state уходят сайту во фрагменте (в логи сервера и Referer не попадают).
  router.get(`${base}/callback`, (request: Request, response: Response) => {
    const rawState = typeof request.query.state === 'string' ? request.query.state : '';
    const state = rawState ? readGoogleState(rawState) : null;
    if (!state) {
      response.redirect(302, withFragment(fallbackReturnTo(), { google_error: 'state' }));
      return;
    }
    const returnTo = safeReturnTo(state.returnTo) ?? fallbackReturnTo();
    const error = typeof request.query.error === 'string' ? request.query.error : '';
    const code = typeof request.query.code === 'string' ? request.query.code : '';
    if (error || !code || code.length > 512) {
      response.redirect(
        302,
        withFragment(returnTo, { google_error: error === 'access_denied' ? 'denied' : 'failed' }),
      );
      return;
    }
    response.redirect(302, withFragment(returnTo, { google_code: code, google_state: rawState }));
  });

  router.post(`${base}/confirm`, requireAuth, async (request: Request, response: Response) => {
    const oauth = settings()!;
    const userId = request.user!.id;
    const body = (request.body ?? {}) as { code?: unknown; state?: unknown; timeZone?: unknown };
    prefs?.rememberTimeZone(userId, body.timeZone);
    if (typeof body.code !== 'string' || typeof body.state !== 'string' || body.code.length > 512) {
      sendError(
        response,
        400,
        'invalid_request',
        'Не хватает данных от Google. Подключите ещё раз.',
      );
      return;
    }
    const state = readGoogleState(body.state);
    // Код обменивается только в той сессии, что начала подключение, и только один раз.
    const verifier =
      state && state.userId === userId ? verifiers.take(state.nonce, userId) : undefined;
    if (!state || !verifier) {
      sendError(
        response,
        400,
        'google_state_invalid',
        'Ссылка подключения устарела, уже использована или открыта в другом аккаунте. Подключите Google ещё раз.',
      );
      return;
    }

    // Тариф могли снять, а место — занять, пока человек был в Google: проверка до обмена кода.
    if (refusedByTier(userId, response, connected(userId))) return;

    let grant;
    try {
      grant = await exchangeGoogleCode(oauth, body.code, verifier, fetchImpl);
    } catch (error) {
      if (error instanceof GoogleOAuthError) {
        sendError(
          response,
          error.code === 'unavailable' ? 502 : 400,
          `google_${error.code}`,
          error.message,
        );
        return;
      }
      throw error;
    }

    // Тот же аккаунт Google — прежняя таблица; другой — новая (к прежней доступа нет).
    const previous = store.get(userId);
    const previousToken = store.refreshTokenOf(userId);
    let spreadsheet =
      previous && previous.googleSub === grant.identity.sub && previous.spreadsheetId
        ? { id: previous.spreadsheetId, url: previous.spreadsheetUrl ?? '' }
        : null;
    // Видит ли Ketner прежнюю таблицу с новым доступом. После отзыва доступа в аккаунте Google
    // `drive.file` её больше не покрывает (проверено в пилоте 22.11): Google отвечает 404. Тогда —
    // новая таблица и на карточке ссылка на прежнюю и «Выбрать прежнюю таблицу». Сбой Google при
    // проверке — таблица остаётся прежней (доставка разберётся сама).
    let lostSheet: { id: string; url: string } | null = null;
    if (spreadsheet) {
      try {
        const check = await checkLeadSpreadsheet(grant.accessToken, spreadsheet.id, fetchImpl, {
          header: false,
        });
        googleDiagnostics.log(`переподключение: прежняя таблица — ${check}`);
        if (check === 'no_access') {
          lostSheet = spreadsheet;
          spreadsheet = null;
        }
      } catch (error) {
        const code = error instanceof GoogleSheetsError ? error.code : 'unavailable';
        googleDiagnostics.log(`переподключение: проверка прежней таблицы не удалась — ${code}`);
      }
    }
    let sheetErrorCode: string | null = null;
    if (!spreadsheet) {
      try {
        spreadsheet = await createLeadSpreadsheet(
          grant.accessToken,
          fetchImpl,
          prefs?.timeZoneOf(userId) ?? null,
        );
      } catch (error) {
        sheetErrorCode = error instanceof GoogleSheetsError ? error.code : 'sheet_not_created';
        log(`[google] таблица заявок для аккаунта ${userId} не создана: ${sheetErrorCode}`);
      }
    }

    let saved: GoogleConnection;
    try {
      saved = await store.connect({
        userId,
        googleSub: grant.identity.sub,
        googleEmail: grant.identity.email,
        scopes: grant.scopes,
        refreshToken: grant.refreshToken,
        spreadsheet,
        sheetErrorCode,
      });
    } catch (error) {
      // Не сохранили — не держим доступ: отзываем выданный только что.
      if (!(await revokeGoogleToken(grant.refreshToken, fetchImpl))) {
        log(`[google] отзыв несохранённого доступа аккаунта ${userId} не удался`);
      }
      throw error;
    }
    delivery?.forget(userId);
    if (lostSheet) {
      await prefs?.setLostSheet(userId, lostSheet).catch((error: unknown) => {
        log(`[google] прежняя таблица аккаунта ${userId} не записана: ${String(error)}`);
      });
    }
    if (previousToken && previousToken !== grant.refreshToken) {
      if (!(await revokeGoogleToken(previousToken, fetchImpl))) {
        log(`[google] отзыв прежнего доступа аккаунта ${userId} не удался`);
      }
    }
    response.json(cardStatus(userId, saved));
  });

  // Google Picker в браузере владельца: короткий access-токен (около часа, те же `drive.file`),
  // ключ API и номер проекта. Только при живом подключении и настроенном Picker.
  router.post(`${base}/picker-token`, requireAuth, async (request: Request, response: Response) => {
    const userId = request.user!.id;
    const config = pickerConfig();
    const connection = store.get(userId);
    if (!config || !delivery) {
      sendError(response, 404, 'picker_unavailable', 'Выбор таблицы сейчас недоступен.');
      return;
    }
    if (!connection || connection.status === 'disconnected') {
      sendError(response, 409, 'google_not_connected', 'Сначала подключите Google Таблицу.');
      return;
    }
    if (refusedByTier(userId, response, true)) return;
    try {
      const accessToken = await delivery.pickerToken(userId);
      googleDiagnostics.log('выбор таблицы: выдан токен для Google Picker');
      response.json({ accessToken, apiKey: config.apiKey, appId: config.appId });
    } catch (error) {
      const code = error instanceof GoogleSheetsError ? error.code : 'unavailable';
      const reconnect =
        code === 'invalid_grant' || code === 'token_unreadable' || code === 'disconnected';
      sendError(
        response,
        reconnect ? 409 : 502,
        reconnect ? 'google_reconnect_required' : 'google_unavailable',
        reconnect
          ? 'Доступ к Google отозван. Подключите таблицу снова.'
          : 'Google не ответил. Попробуйте ещё раз через минуту.',
      );
    }
  });

  // Таблица, выбранная в Google Picker: проверяем на сервере и пишем заявки в неё.
  router.post(`${base}/pick-sheet`, requireAuth, async (request: Request, response: Response) => {
    const userId = request.user!.id;
    const spreadsheetId = (request.body as { spreadsheetId?: unknown } | undefined)?.spreadsheetId;
    if (!delivery || !validSpreadsheetId(spreadsheetId)) {
      sendError(response, 400, 'invalid_request', 'Не удалось прочитать выбранный файл.');
      return;
    }
    if (refusedByTier(userId, response, true)) return;
    const picked = await delivery.pickSheet(userId, spreadsheetId);
    googleDiagnostics.log(`выбор таблицы: ${picked.result}`);
    if (picked.result === 'ok') {
      await prefs?.setLostSheet(userId, null).catch((error: unknown) => {
        log(`[google] прежняя таблица аккаунта ${userId} не забыта: ${String(error)}`);
      });
      response.json({
        ...cardStatus(userId, picked.connection),
        pending: await delivery.pending(userId),
      });
      return;
    }
    const refusal = PICK_REFUSALS[picked.result];
    sendError(response, refusal.status, refusal.code, refusal.message);
  });

  // «Понятно»: убрать сообщение о прежней таблице (ссылку на неё можно найти в Диске).
  router.post(
    `${base}/previous-sheet/dismiss`,
    requireAuth,
    async (request: Request, response: Response) => {
      const userId = request.user!.id;
      await prefs?.setLostSheet(userId, null);
      response.json(cardStatus(userId));
    },
  );

  router.delete(`${base}/connection`, requireAuth, async (request: Request, response: Response) => {
    const userId = request.user!.id;
    const token = store.refreshTokenOf(userId);
    const connection = await store.disconnect(userId);
    delivery?.forget(userId);
    await prefs?.setLostSheet(userId, null).catch(() => undefined);
    // Отзыв — по возможности: отключение в Ketner уже состоялось, токен стёрт.
    if (token && !(await revokeGoogleToken(token, fetchImpl))) {
      log(`[google] отзыв доступа при отключении аккаунта ${userId} не удался`);
    }
    response.json(publicStatus(connection));
  });

  return router;
}
