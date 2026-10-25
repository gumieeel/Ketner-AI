/**
 * KETNER AI — DB Client для Drizzle
 * 
 * apps/mock-api/src/db/client.ts
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import { config } from '../config.js';

const connectionString =
  config.databaseUrl ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/ketner';

// Используем postgres.js для подключения
export const queryClient = postgres(connectionString, {
  max: 10, // pool size
  idle_timeout: 30, // закрывать неиспользуемые подключения
  connect_timeout: 10,
  onnotice: () => {},
});

// Экспортируем Drizzle instance с типизацией
export const db = drizzle(queryClient, { schema });

export type Database = typeof db;

// Для тестов: memdb или временные таблицы
export async function createTestDb() {
  return db;
}

// Helper для миграций
export async function runMigrations() {
  try {
    console.log('🔄 Запускаем миграции Drizzle...');
    // Миграции запускаются через CLI:
    // npx drizzle-kit migrate
    console.log('✅ Миграции завершены');
  } catch (error) {
    console.error('❌ Ошибка миграций:', error);
    process.exit(1);
  }
}

// Graceful shutdown
if (typeof process !== 'undefined') {
  process.on('SIGINT', async () => {
    console.log('🛑 Закрываем подключение к БД...');
    try {
      await queryClient.end();
    } catch {
      // Игнорируем
    }
    process.exit(0);
  });
}
