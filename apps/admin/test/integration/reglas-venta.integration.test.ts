import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { guardarReglasVenta, leerReglasVenta } from "@/lib/reglas-venta-repo"
import { REGLAS_VENTA_DEFAULT } from "@/lib/reglas-venta-validacion"
import { guardarOverlay, leerOverlay } from "@/lib/catalogo-overlay-repo"
import { seedTenant, truncateAll } from "./helpers"

/**
 * Migración 0045 (change `sucursales-igz-mdp`, rebanada B) contra la base real de test:
 * `reglas_venta` (defaults, CHECK, aislamiento por tenant) y `catalog_overlay.oculto_en_sucursales`
 * (default vacío en filas nuevas y existentes). Datos inventados.
 */

const A = "tenant-a"
const B = "tenant-b"

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
  await seedTenant(B)
})
afterAll(async () => {
  await truncateAll()
})

describe("reglas_venta", () => {
  it("sin fila devuelve los defaults del design", async () => {
    expect(await leerReglasVenta(A)).toEqual(REGLAS_VENTA_DEFAULT)
  })

  it("el primer guardado crea la fila con el resto en default y el siguiente cambia solo lo enviado", async () => {
    const r1 = await guardarReglasVenta(A, { reservaDias: 0 })
    expect(r1).toEqual({ kind: "ok", reglas: { ...REGLAS_VENTA_DEFAULT, reservaDias: 0 } })
    const r2 = await guardarReglasVenta(A, { retiroSinStock: "bloquear", trasladoDias: "3" })
    expect(r2).toEqual({
      kind: "ok",
      reglas: { ...REGLAS_VENTA_DEFAULT, reservaDias: 0, retiroSinStock: "bloquear", trasladoDias: 3 },
    })
    expect((await leerReglasVenta(A)).reservaDias).toBe(0)
  })

  it("un valor inválido no toca la base", async () => {
    const r = await guardarReglasVenta(A, { trasladoDias: -1 })
    expect(r).toMatchObject({ kind: "invalid", campo: "trasladoDias" })
    expect(await leerReglasVenta(A)).toEqual(REGLAS_VENTA_DEFAULT)
  })

  it("cada tenant tiene sus reglas", async () => {
    await guardarReglasVenta(A, { reservaDias: 30 })
    expect((await leerReglasVenta(B)).reservaDias).toBe(7)
    expect((await leerReglasVenta(A)).reservaDias).toBe(30)
  })

  it("los CHECK de la base rechazan negativos y un retiro_sin_stock desconocido", async () => {
    await guardarReglasVenta(A, {})
    await expect(getDb().execute(sql`update reglas_venta set reserva_dias = -1 where tenant_id = ${A}`)).rejects.toThrow()
    await expect(getDb().execute(sql`update reglas_venta set retiro_sin_stock = 'otro' where tenant_id = ${A}`)).rejects.toThrow()
  })
})

describe("catalog_overlay.oculto_en_sucursales", () => {
  it("una fila nueva del overlay nace con la lista vacía (visible en todas)", async () => {
    const fila = await guardarOverlay(A, "prod-1", { visible: true })
    expect(fila.ocultoEnSucursales).toEqual([])
  })

  it("guarda y lee los slugs", async () => {
    await guardarOverlay(A, "prod-2", { visible: true })
    await guardarOverlay(A, "prod-2", { ocultoEnSucursales: ["mdp"] })
    expect((await leerOverlay(A, "prod-2"))?.ocultoEnSucursales).toEqual(["mdp"])
  })
})
