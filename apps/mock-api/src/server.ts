import { defaultBetterAuth, initAuthDatabase } from './auth/better-auth.js';
import { createApp } from './app.js';
import { config } from './config.js';

await initAuthDatabase(defaultBetterAuth);
const app = createApp();

app.listen(config.port, () => {
  console.log(`[mock-api] ${config.serviceName} слушает http://127.0.0.1:${config.port}`);
  console.log(`[mock-api] контракт API: http://127.0.0.1:${config.port}/api`);
});
