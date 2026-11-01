/**
 * Документация совпадает с кодом (этап 9): каждый маршрут анализа и Builder описан в docs/api.md,
 * и в api.md нет маршрутов, которых нет в коде. Пути сравниваются без имён параметров.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Router } from 'express';
import { config } from '../config.js';
import { createAnalysesRouter } from './analyses.js';
import { createBotsRouter } from './bots.js';
import { createSolutionsRouter } from './solutions.js';

const API_MD = new URL('../../../../docs/api.md', import.meta.url);

type Layer = { route?: { path: string; methods: Record<string, boolean> } };

/** Маршруты из стека роутера Express: `GET /analyses/:` и т. п. */
function routesOf(prefix: string, router: Router): Set<string> {
  const result = new Set<string>();
  for (const layer of (router as unknown as { stack: Layer[] }).stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) {
      if (method === '_all') continue;
      result.add(normalize(`${method.toUpperCase()} ${prefix}${layer.route.path}`));
    }
  }
  return result;
}

function normalize(route: string): string {
  return route.replace(/:[A-Za-z]+/g, ':').replace(/\/$/, '');
}

/**
 * Разворачивает сокращения api.md: `GET\|POST /x`, `/x[/restore]`, `/x/activate\|pause`.
 */
function expand(methods: string, path: string): string[] {
  let paths = [path];
  for (;;) {
    const optional = paths.find((item) => item.includes('['));
    if (!optional) break;
    const match = /\[([^\]]+)\]/.exec(optional)!;
    paths = paths.flatMap((item) =>
      item === optional ? [item.replace(match[0], ''), item.replace(match[0], match[1]!)] : [item],
    );
  }
  paths = paths.flatMap((item) => {
    const segments = item.split('/');
    return segments.reduce<string[]>(
      (prefixes, segment, index) =>
        prefixes.flatMap((prefix) =>
          segment.split('\\|').map((option) => (index === 0 ? option : `${prefix}/${option}`)),
        ),
      [''],
    );
  });
  return methods
    .split('\\|')
    .flatMap((method) => paths.map((item) => normalize(`${method} ${item}`)));
}

function documented(section: string): Set<string> {
  const row = readFileSync(API_MD, 'utf8')
    .split('\n')
    .find((line) => line.startsWith(`| ${section}`));
  assert.ok(row, `в api.md нет строки «${section}»`);
  const result = new Set<string>();
  for (const match of row.matchAll(
    /`((?:GET|POST|PUT|PATCH|DELETE)(?:\\\|[A-Z]+)*) (\/[^`\s]+)`/g,
  )) {
    for (const route of expand(match[1]!, match[2]!)) result.add(route);
  }
  return result;
}

/** Описанные в api.md маршруты, которых нет в коде, и наоборот. */
function compare(code: Set<string>, docs: Set<string>) {
  return {
    undocumented: [...code].filter((route) => !docs.has(route)).sort(),
    missingInCode: [...docs].filter((route) => !code.has(route)).sort(),
  };
}

test('api.md описывает ровно те маршруты анализа, что есть в коде', () => {
  const code = routesOf('/analyses', createAnalysesRouter({ ai: config.ai, enabled: true }));
  assert.ok(code.size >= 13, `маршрутов анализа: ${code.size}`);
  assert.deepEqual(compare(code, documented('Анализ задач')), {
    undocumented: [],
    missingInCode: [],
  });
});

test('api.md описывает ровно те маршруты Builder, что есть в коде', () => {
  const code = routesOf('/solutions', createSolutionsRouter({ ai: config.ai, enabled: true }));
  assert.ok(code.size >= 20, `маршрутов Builder: ${code.size}`);
  assert.deepEqual(compare(code, documented('Помощники (Builder)')), {
    undocumented: [],
    missingInCode: [],
  });
});

test('api.md описывает ровно те маршруты публичной страницы бота, что есть в коде', () => {
  const code = routesOf('/b', createBotsRouter({ bots: () => null, enabled: true }));
  assert.equal(code.size, 4, `маршрутов бота: ${code.size}`);
  assert.deepEqual(compare(code, documented('Бот для клиентов')), {
    undocumented: [],
    missingInCode: [],
  });
});
