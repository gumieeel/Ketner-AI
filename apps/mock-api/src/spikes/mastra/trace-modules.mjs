// СПАЙК T4.0: записывает каждый загруженный модуль (ESM и CommonJS) в файл из TRACE_LOG.
// Запуск: TRACE_LOG=/tmp/x node --import tsx --import ./src/spikes/mastra/trace-modules.mjs --test <файл>
import { appendFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const log = process.env.TRACE_LOG;
if (log) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const result = nextResolve(specifier, context);
      appendFileSync(log, `${result.url}\n`);
      return result;
    },
  });
}
