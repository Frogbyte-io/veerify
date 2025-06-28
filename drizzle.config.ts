import type { Config } from "drizzle-kit";

export default {
  schema: "./server/api/auth/auth-schema.ts",
  out: "./server/database/migrations",
  dialect: "postgresql",
  dbCredentials: {
    host: process.env.PGHOST || "localhost",
    port: Number(process.env.PGPORT) || 5432,
    user: process.env.PGUSER || "veerify",
    password: process.env.PGPASSWORD || "veerifypassword",
    database: process.env.PGDATABASE || "veerifydb",
    ssl: false,
  },
} satisfies Config; 