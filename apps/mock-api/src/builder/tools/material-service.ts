/**
 * Материалы инструмента: загрузка, список, просмотр, удаление. Правила — здесь, хранение —
 * в MaterialStore: решение должно быть инструментом владельца, шаблон — принимать материалы,
 * лимиты на число материалов и объём текста соблюдаются до записи.
 */
import { randomUUID } from 'node:crypto';
import type { Language } from '../../types.js';
import type { BuilderStore } from '../store.js';
import { getTemplate, KIND_BY_TYPE } from '../templates.js';
import type { Solution } from '../types.js';
import type { MaterialStore } from './material-store.js';
import {
  buildMaterial,
  MATERIAL_LIMITS,
  summarize,
  type ExtractedDocument,
  type Material,
  type MaterialSummary,
} from './materials.js';

export interface MaterialCaller {
  userId: string;
  language: Language;
}

export type MaterialError = {
  ok: false;
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export interface MaterialUsage {
  count: number;
  maxCount: number;
  userChars: number;
  maxUserChars: number;
  maxMaterialChars: number;
}

export interface MaterialServiceDeps {
  materials: MaterialStore;
  solutions: Pick<BuilderStore, 'getSolution'>;
  now?: () => Date;
}

const text = (language: Language, ru: string, en: string) => (language === 'en' ? en : ru);

export class MaterialService {
  private readonly now: () => Date;

  constructor(private readonly deps: MaterialServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Инструмент владельца, который принимает материалы; иначе — ошибка (чужой — как несуществующий). */
  private async tool(
    caller: MaterialCaller,
    solutionId: string,
  ): Promise<Solution | MaterialError> {
    const solution = await this.deps.solutions.getSolution(caller.userId, solutionId);
    if (!solution) {
      return {
        ok: false,
        status: 404,
        code: 'not_found',
        message: text(caller.language, 'Решение не найдено.', 'Solution not found.'),
      };
    }
    if (KIND_BY_TYPE[solution.type] !== 'tool' || !getTemplate(solution.template)?.materials) {
      return {
        ok: false,
        status: 409,
        code: 'wrong_solution_kind',
        message: text(
          caller.language,
          'В это решение нельзя загружать документы.',
          'Documents cannot be uploaded to this solution.',
        ),
      };
    }
    return solution;
  }

  private async usage(caller: MaterialCaller, count: number): Promise<MaterialUsage> {
    return {
      count,
      maxCount: MATERIAL_LIMITS.materialsPerSolution,
      userChars: await this.deps.materials.totalChars(caller.userId),
      maxUserChars: MATERIAL_LIMITS.materialCharsPerUser,
      maxMaterialChars: MATERIAL_LIMITS.materialChars,
    };
  }

  async list(
    caller: MaterialCaller,
    solutionId: string,
  ): Promise<{ ok: true; materials: MaterialSummary[]; usage: MaterialUsage } | MaterialError> {
    const tool = await this.tool(caller, solutionId);
    if ('ok' in tool) return tool;
    const materials = await this.deps.materials.list(caller.userId, solutionId);
    return { ok: true, materials, usage: await this.usage(caller, materials.length) };
  }

  async add(
    caller: MaterialCaller,
    solutionId: string,
    input: ExtractedDocument,
  ): Promise<{ ok: true; material: MaterialSummary; duplicate: boolean } | MaterialError> {
    const tool = await this.tool(caller, solutionId);
    if ('ok' in tool) return tool;
    const built = buildMaterial(input);
    if (!built.ok) {
      return built.code === 'material_no_text'
        ? {
            ok: false,
            status: 422,
            code: 'material_no_text',
            message: text(
              caller.language,
              'В файле не нашлось текста. Если это скан или фотографии страниц, распознавание текста (OCR) пока не поддерживается.',
              'No text was found in the file. If it is a scan or photos of pages, text recognition (OCR) is not supported yet.',
            ),
          }
        : {
            ok: false,
            status: 413,
            code: 'material_too_large',
            message: text(
              caller.language,
              `В документе ${built.charCount} символов, а можно не больше ${MATERIAL_LIMITS.materialChars}. Загрузите часть страниц.`,
              `The document has ${built.charCount} characters; the limit is ${MATERIAL_LIMITS.materialChars}. Upload part of the pages.`,
            ),
            details: { charCount: built.charCount, maxChars: MATERIAL_LIMITS.materialChars },
          };
    }

    const existing = await this.deps.materials.list(caller.userId, solutionId);
    if (existing.length >= MATERIAL_LIMITS.materialsPerSolution) {
      return {
        ok: false,
        status: 409,
        code: 'materials_limit',
        message: text(
          caller.language,
          `В инструменте не больше ${MATERIAL_LIMITS.materialsPerSolution} документов. Удалите ненужные.`,
          `A tool holds at most ${MATERIAL_LIMITS.materialsPerSolution} documents. Delete ones you no longer need.`,
        ),
      };
    }
    const userChars = await this.deps.materials.totalChars(caller.userId);
    if (userChars + built.charCount > MATERIAL_LIMITS.materialCharsPerUser) {
      return {
        ok: false,
        status: 409,
        code: 'materials_storage_limit',
        message: text(
          caller.language,
          'Место для документов закончилось. Удалите ненужные документы в своих инструментах.',
          'Document storage is full. Delete documents you no longer need in your tools.',
        ),
        details: { userChars, maxUserChars: MATERIAL_LIMITS.materialCharsPerUser },
      };
    }

    const material: Material = {
      id: randomUUID(),
      solutionId,
      ownerId: caller.userId,
      name: built.name,
      format: built.format,
      sizeBytes: built.sizeBytes,
      charCount: built.charCount,
      sections: built.sections,
      contentHash: built.contentHash,
      createdAt: this.now().toISOString(),
    };
    const result = await this.deps.materials.add(material);
    if (result.status === 'not_found') {
      return {
        ok: false,
        status: 404,
        code: 'not_found',
        message: text(caller.language, 'Решение не найдено.', 'Solution not found.'),
      };
    }
    return {
      ok: true,
      material: summarize(result.material),
      duplicate: result.status === 'duplicate',
    };
  }

  async get(
    caller: MaterialCaller,
    solutionId: string,
    id: string,
  ): Promise<{ ok: true; material: Material } | MaterialError> {
    const tool = await this.tool(caller, solutionId);
    if ('ok' in tool) return tool;
    const material = await this.deps.materials.get(caller.userId, solutionId, id);
    if (!material) return this.missing(caller);
    return { ok: true, material };
  }

  async remove(
    caller: MaterialCaller,
    solutionId: string,
    id: string,
  ): Promise<{ ok: true } | MaterialError> {
    const tool = await this.tool(caller, solutionId);
    if ('ok' in tool) return tool;
    return (await this.deps.materials.remove(caller.userId, solutionId, id))
      ? { ok: true }
      : this.missing(caller);
  }

  private missing(caller: MaterialCaller): MaterialError {
    return {
      ok: false,
      status: 404,
      code: 'material_not_found',
      message: text(caller.language, 'Документ не найден.', 'Document not found.'),
    };
  }
}
