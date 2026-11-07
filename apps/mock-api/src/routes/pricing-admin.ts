/**
 * Админка смет (`/api/admin/pricing`, только администратор — проверка на сервере):
 *
 *   GET  /config                          действующая версия: настройки и каталог работ
 *   GET  /versions                        история версий
 *   PUT  /config                          новые настройки → новая версия { baseVersion, config, reason }
 *   PUT  /catalog/:id                     работа каталога (создать/изменить) → новая версия
 *   GET  /estimates                       последние сметы (все анализы)
 *   GET  /estimates/:id                   смета целиком: строки, часы, ставка, резерв
 *   GET  /requests[?status=]              заявки
 *   GET  /requests/:id                    заявка целиком с журналом
 *   PATCH /requests/:id                   статус, назначение, заметка { reason }
 *   POST /requests/:id/review             проверенная смета; approve — коммерческое предложение
 *   PUT  /requests/:id/actuals            факт проекта (часы, расходы, итоговая цена)
 *   GET  /calibration                     точность смет по фактическим проектам
 *
 * Каждое изменение пишется в журнал (кто, что было, что стало, причина, когда). Сметы клиентов
 * при смене настроек не меняются: у них свой снимок.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sendError } from '../middleware/errors.js';
import { getDiscoveryStores, type DiscoveryStores } from '../discovery/runtime.js';
import { calibrationReport } from '../pricing/calibration.js';
import { pricingServiceFor } from '../pricing/runtime.js';
import type { PricingService } from '../pricing/service.js';
import { REQUEST_STATUSES } from '../pricing/types.js';
import { adminActorId, requireAdmin } from './admin.js';

export interface PricingAdminDeps {
  stores?: () => DiscoveryStores | null;
}

const range = z
  .object({
    min: z.number().int().min(0),
    expected: z.number().int().min(0),
    max: z.number().int().min(0),
  })
  .refine(
    (value) => value.min <= value.expected && value.expected <= value.max,
    'min ≤ expected ≤ max',
  );

const reviewSchema = z.object({
  priceKzt: range,
  /** Часы (не центичасы): администратор вводит как удобно. */
  hours: z
    .object({ min: z.number().min(0), expected: z.number().min(0), max: z.number().min(0) })
    .nullable()
    .default(null),
  workingDays: z.tuple([z.number().int().min(0).max(365), z.number().int().min(0).max(365)]),
  customerNote: z.string().max(2000).default(''),
  approve: z.boolean().default(false),
  reason: z.string().trim().min(3).max(500),
});

const actualsSchema = z.object({
  actualHours: z.number().min(0).max(100_000),
  actualDirectKzt: z.number().int().min(0).max(1_000_000_000),
  finalPriceKzt: z.number().int().min(0).max(1_000_000_000),
  actualMonthlyUsageKzt: z.number().int().min(0).max(1_000_000_000).nullable().default(null),
  scopeChanges: z.string().max(2000).default(''),
  difficulties: z.string().max(2000).default(''),
  deviationReasons: z.string().max(2000).default(''),
  reason: z.string().trim().max(500).default('Факт проекта'),
});

const updateSchema = z.object({
  status: z.enum(REQUEST_STATUSES).optional(),
  /** `me` — назначить себя; null — снять назначение. */
  assignedAdminId: z.union([z.literal('me'), z.null()]).optional(),
  note: z.string().max(2000).optional(),
  reason: z.string().trim().max(500).default(''),
});

const centi = (hours: number) => Math.round(hours * 100);

export function createPricingAdminRouter(deps: PricingAdminDeps = {}): Router {
  const router = Router();
  const stores = deps.stores ?? getDiscoveryStores;
  router.use(requireAdmin);

  const service = (response: Response): PricingService | null => {
    const found = pricingServiceFor(stores());
    if (!found) sendError(response, 503, 'pricing_unavailable', 'Сметы недоступны: нет хранилища.');
    return found;
  };
  const fail = (response: Response, result: { status: number; code: string; message: string }) =>
    sendError(response, result.status, result.code, result.message);

  router.get('/config', async (_request: Request, response: Response) => {
    const pricing = service(response);
    if (!pricing) return;
    response.json({ version: await pricing.active() });
  });

  router.get('/versions', async (_request: Request, response: Response) => {
    const pricing = service(response);
    if (!pricing) return;
    await pricing.active();
    const versions = await pricing.store.listVersions(50);
    response.json({
      versions: versions.map(({ version, note, createdBy, createdAt }) => ({
        version,
        note,
        createdBy,
        createdAt,
      })),
    });
  });

  router.put('/config', async (request: Request, response: Response) => {
    const pricing = service(response);
    if (!pricing) return;
    const body = z
      .object({
        baseVersion: z.number().int().min(1),
        config: z.unknown(),
        reason: z.string().default(''),
      })
      .safeParse(request.body);
    if (!body.success) {
      sendError(response, 400, 'validation_failed', 'Ожидается { baseVersion, config, reason }');
      return;
    }
    const result = await pricing.updateConfig(
      adminActorId(request),
      body.data.baseVersion,
      body.data.config,
      body.data.reason,
    );
    if (!result.ok) return fail(response, result);
    response.json({ version: result.version });
  });

  router.put('/catalog/:id', async (request: Request, response: Response) => {
    const pricing = service(response);
    if (!pricing) return;
    const body = z
      .object({
        baseVersion: z.number().int().min(1),
        item: z.unknown(),
        reason: z.string().default(''),
      })
      .safeParse(request.body);
    if (!body.success) {
      sendError(response, 400, 'validation_failed', 'Ожидается { baseVersion, item, reason }');
      return;
    }
    const result = await pricing.upsertCatalogItem(
      adminActorId(request),
      body.data.baseVersion,
      String(request.params.id),
      body.data.item,
      body.data.reason,
    );
    if (!result.ok) return fail(response, result);
    response.json({ version: result.version });
  });

  router.get('/estimates', async (_request: Request, response: Response) => {
    const pricing = service(response);
    if (!pricing) return;
    const items = await pricing.store.listEstimates(200);
    response.json({
      estimates: items.map(({ estimate, ownerId }) => ({
        id: estimate.id,
        analysisId: estimate.analysisId,
        ownerId,
        generation: estimate.generation,
        scope: estimate.scope,
        opportunityTitles: estimate.opportunityTitles,
        pricingVersion: estimate.pricingVersion,
        priceKzt: estimate.result.priceKzt,
        hours: estimate.result.hours,
        confidence: estimate.result.confidence,
        requiresManualReview: estimate.result.requiresManualReview,
        excluded: estimate.result.excluded.length,
        createdAt: estimate.createdAt,
      })),
    });
  });

  router.get('/estimates/:id', async (request: Request, response: Response) => {
    const pricing = service(response);
    if (!pricing) return;
    const estimate = await pricing.store.getEstimate(String(request.params.id));
    if (!estimate) {
      sendError(response, 404, 'not_found', 'Смета не найдена');
      return;
    }
    response.json({ estimate, audit: await pricing.store.audit('estimate', estimate.id) });
  });

  router.get('/requests', async (request: Request, response: Response) => {
    const pricing = service(response);
    if (!pricing) return;
    const status = z.enum(REQUEST_STATUSES).optional().safeParse(request.query.status);
    const items = await pricing.store.listRequests({
      ...(status.success && status.data ? { status: status.data } : {}),
      limit: 200,
    });
    response.json({
      requests: items.map((item) => ({
        id: item.id,
        userId: item.userId,
        status: item.status,
        scope: item.scope,
        opportunityTitles: item.snapshot.opportunityTitles,
        contact: item.contact,
        industry: item.industry,
        preliminaryPriceKzt: item.snapshot.result.priceKzt,
        reviewed: item.reviewed,
        confidence: item.snapshot.result.confidence,
        requiresManualReview: item.snapshot.result.requiresManualReview,
        assignedAdminId: item.assignedAdminId,
        hasActuals: item.actuals !== null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
    });
  });

  router.get('/requests/:id', async (request: Request, response: Response) => {
    const pricing = service(response);
    if (!pricing) return;
    const found = await pricing.store.getRequest(String(request.params.id));
    if (!found) {
      sendError(response, 404, 'not_found', 'Заявка не найдена');
      return;
    }
    response.json({
      request: found,
      audit: [
        ...(await pricing.store.audit('request', found.id)),
        ...(await pricing.store.audit('estimate', found.estimateId)),
      ].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    });
  });

  router.patch('/requests/:id', async (request: Request, response: Response) => {
    const pricing = service(response);
    if (!pricing) return;
    const body = updateSchema.safeParse(request.body);
    if (!body.success) {
      sendError(response, 400, 'validation_failed', 'Неверные поля заявки');
      return;
    }
    const actor = adminActorId(request);
    const result = await pricing.adminUpdateRequest(
      actor,
      String(request.params.id),
      {
        ...(body.data.status ? { status: body.data.status } : {}),
        ...(body.data.assignedAdminId !== undefined
          ? { assignedAdminId: body.data.assignedAdminId === 'me' ? actor : null }
          : {}),
        ...(body.data.note ? { note: body.data.note } : {}),
      },
      body.data.reason,
    );
    if (!result.ok) return fail(response, result);
    response.json({ request: result.request });
  });

  router.post('/requests/:id/review', async (request: Request, response: Response) => {
    const pricing = service(response);
    if (!pricing) return;
    const body = reviewSchema.safeParse(request.body);
    if (!body.success) {
      sendError(
        response,
        400,
        'validation_failed',
        'Проверьте цену (от ≤ ожидаемая ≤ до), сроки и причину.',
      );
      return;
    }
    const { hours, reason, ...rest } = body.data;
    const result = await pricing.reviewEstimate(
      adminActorId(request),
      String(request.params.id),
      {
        ...rest,
        hours: hours
          ? { min: centi(hours.min), expected: centi(hours.expected), max: centi(hours.max) }
          : null,
      },
      reason,
    );
    if (!result.ok) return fail(response, result);
    response.json({ request: result.request });
  });

  router.put('/requests/:id/actuals', async (request: Request, response: Response) => {
    const pricing = service(response);
    if (!pricing) return;
    const body = actualsSchema.safeParse(request.body);
    if (!body.success) {
      sendError(response, 400, 'validation_failed', 'Проверьте фактические часы и суммы.');
      return;
    }
    const { reason, actualHours, ...rest } = body.data;
    const result = await pricing.recordActuals(
      adminActorId(request),
      String(request.params.id),
      { ...rest, actualHours: centi(actualHours) },
      reason,
    );
    if (!result.ok) return fail(response, result);
    response.json({ request: result.request });
  });

  router.get('/calibration', async (_request: Request, response: Response) => {
    const pricing = service(response);
    if (!pricing) return;
    const active = await pricing.active();
    const requests = await pricing.store.listRequests({ limit: 1000 });
    response.json({
      report: calibrationReport(requests, active.catalog, active.config),
      version: active.version,
    });
  });

  return router;
}
