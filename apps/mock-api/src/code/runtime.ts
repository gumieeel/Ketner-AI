/**
 * Общие экземпляры Ketner Code: хранилище проектов и песочница.
 * Создаются лениво: тесты и скрипты, не использующие код-режим, ничего не трогают на диске.
 */

import { config, isProduction } from '../config.js';
import { ProjectStore, type ProjectDbDriver } from './project-store.js';
import { createSandbox, type SandboxRunner } from './sandbox.js';

let store: ProjectStore | null = null;
let sandbox: SandboxRunner | null | undefined;

export function getProjectStore(): ProjectStore {
  if (!store) store = new ProjectStore({ rootDir: config.code.projectsDir });
  return store;
}

/** Подключает драйвер БД (после инициализации Postgres). Без драйвера хранилище работает на диске. */
export function attachProjectDriver(driver: ProjectDbDriver | null): void {
  getProjectStore().setDriver(driver);
}

export function getSandbox(): SandboxRunner | null {
  if (sandbox === undefined) {
    sandbox = createSandbox({
      mode: config.code.sandboxMode,
      dockerImage: config.code.sandboxDockerImage || undefined,
      isProduction,
      allowLocalInProduction: config.code.sandboxAllowLocalInProduction,
    });
  }
  return sandbox;
}
