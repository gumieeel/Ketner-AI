import { defineConfig } from 'drizzle-kit';
import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'node:fs';

const envPath = existsSync('apps/mock-api/.env')
  ? 'apps/mock-api/.env'
  : existsSync('.env')
    ? '.env'
    : undefined;

if (envPath) {
  dotenvConfig({ path: envPath });
}

export default defineConfig({
  schema: './apps/mock-api/src/db/schema.ts',
  out: './apps/mock-api/src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ketner',
  },
  verbose: true,
  strict: true,
});
