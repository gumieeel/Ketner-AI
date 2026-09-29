import { defineConfig } from 'drizzle-kit';
import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'node:fs';

if (existsSync('.env')) {
  dotenvConfig({ path: '.env' });
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ketner',
  },
  verbose: true,
  strict: true,
});
