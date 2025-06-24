import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import 'dotenv/config';

const client = new Client({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER || 'veerify',
  password: process.env.PGPASSWORD || 'veerifypassword',
  database: process.env.PGDATABASE || 'veerifydb',
});

export const dbPromise = (async () => {
  await client.connect();
  console.log('Connected to PostgreSQL');
  return drizzle(client);
})();