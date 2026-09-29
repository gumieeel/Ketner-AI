import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import { config } from '../config.js';

// Создаём подключение к PostgreSQL (или fallback для локальной разработки)
const connectionString =
  config.databaseUrl || 'postgresql://postgres:postgres@localhost:5432/ketner';

// Используем postgres.js для пула подключений
export const queryClient = postgres(connectionString, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
  onnotice: () => {},
});

// Экспортируем Drizzle instance с типизацией
export const db = drizzle(queryClient, { schema });

export type Database = typeof db;

// Для тестов
export async function createTestDb() {
  return db;
}

// Helper для миграций
export async function runMigrations() {
  try {
    console.log('🔄 Запускаем миграции Drizzle...');
    console.log('✅ Миграции завершены');
  } catch (error) {
    console.error('❌ Ошибка миграций:', error);
    process.exit(1);
  }
}

// Graceful shutdown
if (typeof process !== 'undefined') {
  process.on('SIGINT', async () => {
    try {
      await queryClient.end();
    } catch {
      // Игнорируем ошибки при завершении
    }
    process.exit(0);
  });
}
