import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // Mismo orden de precedencia que src/db/migrate.ts: la integración Neon/Vercel
  // inyecta POSTGRES_URL*, no DATABASE_URL.
  dbCredentials: {
    url:
      process.env.POSTGRES_URL_NON_POOLING ??
      process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      "postgres://localhost:5432/shop",
  },
});
