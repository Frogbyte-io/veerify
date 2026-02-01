import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import * as schema from './schema/index';
import 'dotenv/config';

const client = process.env.DATABASE_URL
  ? new Client({ connectionString: process.env.DATABASE_URL })
  : new Client({
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT) || 5432,
      user: process.env.PGUSER || 'veerify',
      password: process.env.PGPASSWORD || 'veerifypassword',
      database: process.env.PGDATABASE || 'veerifydb',
      ssl: false,
    });

// Initialize connection
client.connect().then(() => {
  console.log('Connected to PostgreSQL');
}).catch(console.error);

// Export the drizzle instance with schema
export const db = drizzle(client, { schema });

// Export the promise version for backwards compatibility
export const dbPromise = Promise.resolve(db);