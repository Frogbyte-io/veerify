import type { Config } from "drizzle-kit";

export default {
  schema: "./server/database/schema/index.ts",
  out: "./server/database/migrations",
  dialect: "postgresql",
  dbCredentials: process.env.DATABASE_URL
    ? { url: process.env.DATABASE_URL }
    : {
        host: process.env.PGHOST || "localhost",
        port: Number(process.env.PGPORT) || 5432,
        user: process.env.PGUSER || "veerify",
        password: process.env.PGPASSWORD || "veerifypassword",
        database: process.env.PGDATABASE || "veerifydb",
        ssl: false,
      },
} satisfies Config; 