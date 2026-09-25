// scripts/init-db.ts
import { ensureRegistry } from '../src/db-namespaces';

async function initDatabase() {
  console.log('Initializing database...');
  try {
    await ensureRegistry();
    console.log('Database initialized successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error initializing database:', error);
    process.exit(1);
  }
}

initDatabase();