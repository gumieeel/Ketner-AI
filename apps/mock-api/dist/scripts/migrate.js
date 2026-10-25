import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, queryClient } from '../db/client.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
async function runMigrations() {
    console.log('🔄 Running migrations...');
    try {
        await migrate(db, {
            migrationsFolder: path.join(__dirname, '../db/migrations'),
        });
        console.log('✅ Migrations completed');
        await queryClient.end();
        process.exit(0);
    }
    catch (error) {
        console.error('❌ Migration failed:', error);
        try {
            await queryClient.end();
        }
        catch {
            // Игнорируем ошибку закрытия
        }
        process.exit(1);
    }
}
runMigrations();
