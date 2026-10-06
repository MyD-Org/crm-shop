import { TEST_DATABASE_URL } from "./db-url"

// setupFile de los tests de integración: corre en cada worker antes de cada archivo. Apunta
// DATABASE_URL (la que lee getDb()) al clon de ESTE worker; el `env` de vitest.config.ts es
// uno solo para todos los workers y no sabe cuál es cuál.
process.env.DATABASE_URL = TEST_DATABASE_URL
