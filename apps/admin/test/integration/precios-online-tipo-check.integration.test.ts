import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { seedTenant, truncateAll } from "./helpers"

// R5.1: el CHECK de tipos del historial de precios online (reescrito completo en la 0103) acepta
// 'ajuste_lote' y todos los tipos anteriores, y rechaza uno inventado.

const T = "tenant-chk"
const TIPOS = [
  "lista_alta", "lista_edicion", "lista_baja", "referencia", "override_alta", "override_edicion", "override_baja",
  "umbral", "condicion", "revertir", "costo_aprobado", "costo_rechazado", "mapeo", "campania", "cupon", "ajuste_lote",
]

beforeEach(async () => {
  await truncateAll()
  await seedTenant(T)
})
afterAll(async () => {
  await truncateAll()
})

const insertar = (tipo: string) =>
  getDb().execute(sql`INSERT INTO precios_online_cambios (tenant_id, tipo, objeto, usuario) VALUES (${T}, ${tipo}, 'x', 'ana@example.com')`)

describe("precios_online_cambios_tipo_chk", () => {
  it.each(TIPOS)("acepta %s", async (tipo) => {
    await expect(insertar(tipo)).resolves.toBeDefined()
  })
  it("rechaza un tipo inventado", async () => {
    await expect(insertar("inventado")).rejects.toThrow()
  })
})
