import { db, queryClient } from '../db/client.js';
import { users } from '../db/schema.js';
async function testConnection() {
    try {
        const allUsers = await db.select().from(users).limit(5);
        console.log('✅ Database connection successful!');
        console.log(`📊 Total users: ${allUsers.length}`);
        await queryClient.end();
    }
    catch (error) {
        console.error('❌ Database connection failed:', error);
        try {
            await queryClient.end();
        }
        catch {
            // Игнорируем
        }
    }
}
testConnection();
