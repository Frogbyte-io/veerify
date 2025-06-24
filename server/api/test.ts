import { dbPromise } from '../database/drizzle';

export default defineEventHandler(async (event) => {
  const db = await dbPromise;
  console.log('called /api/test with method:', getMethod(event));
  return { ok: true };
});