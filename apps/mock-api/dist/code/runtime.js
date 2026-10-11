/**
 * Общие экземпляры Ketner Code: хранилище проектов и песочница.
 * Создаются лениво: тесты и скрипты, не использующие код-режим, ничего не трогают на диске.
 */
import { config, isProduction } from '../config.js';
import { ProjectStore } from './project-store.js';
import { createSandbox } from './sandbox.js';
let store = null;
let sandbox;
export function getProjectStore() {
    if (!store)
        store = new ProjectStore({ rootDir: config.code.projectsDir });
    return store;
}
/** Подключает драйвер БД (после инициализации Postgres). Без драйвера хранилище работает на диске. */
export function attachProjectDriver(driver) {
    getProjectStore().setDriver(driver);
}
export function getSandbox() {
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
