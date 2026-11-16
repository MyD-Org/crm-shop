import { beforeEach, describe, expect, it } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { sugerenciasAlta } from "@/lib/compras-producto-sugerencias-repo"
import { seedTenant, truncateAll } from "./helpers"

// Sugerencias de «Crear producto» contra Postgres real (crm_test). Datos inventados.

const A = "tenant-a"
const db = () => getDb()

async function sembrar(alegraId: string, code: string, brand: string, iva: number, cat: string | null) {
  await db().execute(sql`
    INSERT INTO catalog_products (tenant_id, alegra_id, code, name, brand, iva_porcentaje, category_alegra_id, status)
    VALUES (${A}, ${alegraId}, ${code}, ${`Producto ${alegraId}`}, ${brand}, ${iva}, ${cat}, 'active')
  `)
}

beforeEach(async () => {
  await truncateAll()
  await db().execute(sql`truncate table catalog_products restart identity cascade`)
  await seedTenant(A)
  await sembrar("1", "02141N-JDV", "Jadever", 21, "12")
  await sembrar("2", "LED9-JDV", "Jadever", 21, "12")
  await sembrar("3", "X1-MCL", "Macroled", 10.5, "20")
})

describe("sugerenciasAlta (DB real)", () => {
  it("marca escrita y conocida: sufijo, IVA y categoría del catálogo (categoría sólo en la principal)", async () => {
    const r = await sugerenciasAlta(A, { principal: true }, { texto: "LED15W", marca: "jadever", proveedorAlegraId: "77" })
    expect(r).toMatchObject({ marca: "jadever", marcaEsSugerida: false, sufijo: "JDV", sufijoEsNuevo: false, ivaPorcentaje: 21, categoriaId: "12", codigo: "LED15W", nombreSoloCodigo: true })
    const sec = await sugerenciasAlta(A, { principal: false }, { texto: "x", marca: "Jadever", proveedorAlegraId: "" })
    expect(sec.categoriaId).toBeNull()
  })

  it("sin marca ni compras previas: la deduce del texto por nombre de marca del catálogo", async () => {
    const r = await sugerenciasAlta(A, { principal: true }, { texto: "Plafón Macroled 18W", marca: "", proveedorAlegraId: "77" })
    expect(r).toMatchObject({ marca: "Macroled", marcaEsSugerida: true, sufijo: "MCL", ivaPorcentaje: 10.5 })
  })

  it("marca nueva: sufijo para revisar", async () => {
    const r = await sugerenciasAlta(A, { principal: true }, { texto: "", marca: "Zeta", proveedorAlegraId: "" })
    expect(r).toMatchObject({ marca: "Zeta", sufijoEsNuevo: true, categoriaId: null })
  })
})
