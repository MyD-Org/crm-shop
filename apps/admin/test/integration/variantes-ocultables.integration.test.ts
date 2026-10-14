import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { ocultarVariante, recalcularGrupos } from "@/lib/catalogo-variantes-repo"
import { seedTenant, truncateAll } from "./helpers"

// Variantes ocultables en la tienda (change `variantes-ocultables`): el upsert del overlay propio de
// la variante y el recálculo del representante, contra Postgres real (crm_test). Datos inventados.

const T = "tenant-oculta"
const OTRO = "tenant-otro-oculta"

async function sembrar(id: string, o: { tipo?: string; padre?: string; opcion?: string; precio?: number; stock?: number; tenant?: string } = {}) {
  const online = o.precio ? JSON.stringify([{ idPriceList: "l1", name: "Online", price: o.precio, main: true }]) : "[]"
  const variante = o.opcion ? JSON.stringify([{ atributo: "Color", opcion: o.opcion }]) : null
  await getDb().execute(sql`
    INSERT INTO catalog_products (tenant_id, alegra_id, name, tipo, padre_alegra_id, variante, stock, status, alegra_status, precios_online)
    VALUES (${o.tenant ?? T}, ${id}, ${"Producto " + id}, ${o.tipo ?? "simple"}, ${o.padre ?? null}, ${variante}::jsonb,
            ${o.stock ?? null}, 'active', 'active', ${online}::jsonb)
  `)
}

async function modelo() {
  await sembrar("P", { tipo: "padre" })
  await sembrar("v1", { tipo: "variante", padre: "P", opcion: "Verde", precio: 100, stock: 5 })
  await sembrar("v2", { tipo: "variante", padre: "P", opcion: "Rojo", precio: 120, stock: 5 })
  await recalcularGrupos(T)
}

const rep = async () =>
  (
    (await getDb().execute(
      sql`SELECT alegra_id FROM catalog_products WHERE tenant_id = ${T} AND grupo_id = 'P' AND es_representante ORDER BY alegra_id`,
    )) as unknown as { alegra_id: string }[]
  ).map((r) => r.alegra_id)

const overlay = async (id: string, tenant = T) =>
  (
    (await getDb().execute(
      sql`SELECT visible, nombre, oculta_en_tienda FROM catalog_overlay WHERE tenant_id = ${tenant} AND alegra_id = ${id}`,
    )) as unknown as { visible: boolean; nombre: string | null; oculta_en_tienda: boolean }[]
  )[0]

beforeEach(async () => {
  await truncateAll()
  await seedTenant(T)
  await seedTenant(OTRO)
})
afterAll(async () => {
  await truncateAll()
})

describe("ocultarVariante", () => {
  it("crea el overlay propio con oculta_en_tienda = true sin tocar visible", async () => {
    await modelo()
    const r = await ocultarVariante(T, "v2", true, null)
    expect(r).toMatchObject({ kind: "ok", grupoId: "P", ocultaEnTienda: true })
    expect(await overlay("v2")).toMatchObject({ visible: false, oculta_en_tienda: true })
  })

  it("al volver a mostrarla conserva el resto del overlay", async () => {
    await modelo()
    await getDb().execute(sql`INSERT INTO catalog_overlay (tenant_id, alegra_id, visible, nombre) VALUES (${T}, 'v2', true, 'Rojo fuego')`)
    await ocultarVariante(T, "v2", true, null)
    await ocultarVariante(T, "v2", false, null)
    expect(await overlay("v2")).toEqual({ visible: true, nombre: "Rojo fuego", oculta_en_tienda: false })
  })

  it("si se oculta la representante, el grupo pasa a otra visible", async () => {
    await modelo()
    expect(await rep()).toEqual(["v1"])
    await ocultarVariante(T, "v1", true, null)
    expect(await rep()).toEqual(["v2"])
    await ocultarVariante(T, "v1", false, null)
    expect(await rep()).toEqual(["v1"])
  })

  it("si todas quedan ocultas, hay una representante pero oculta (el modelo no se muestra)", async () => {
    await modelo()
    await ocultarVariante(T, "v1", true, null)
    await ocultarVariante(T, "v2", true, null)
    expect((await rep()).length).toBe(1)
    expect((await overlay((await rep())[0])).oculta_en_tienda).toBe(true)
  })

  it("rechaza un producto que no es variante agrupada", async () => {
    await modelo()
    await sembrar("s1")
    await recalcularGrupos(T)
    expect(await ocultarVariante(T, "s1", true, null)).toMatchObject({ kind: "invalid" })
    expect(await ocultarVariante(T, "P", true, null)).toMatchObject({ kind: "invalid" })
  })

  it("un producto inexistente o de otro tenant es not_found", async () => {
    await modelo()
    await sembrar("x1", { tenant: OTRO, tipo: "variante" })
    expect(await ocultarVariante(T, "nada", true, null)).toMatchObject({ kind: "not_found" })
    expect(await ocultarVariante(T, "x1", true, null)).toMatchObject({ kind: "not_found" })
    expect(await overlay("x1", OTRO)).toBeUndefined()
  })
})
