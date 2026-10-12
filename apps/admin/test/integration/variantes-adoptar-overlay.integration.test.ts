import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { adoptarOverlayEnAnclas, recalcularGrupos, sumarAGrupo } from "@/lib/catalogo-variantes-repo"
import { seedTenant, truncateAll } from "./helpers"

// Adopción del overlay por el ancla (change `variantes-de-producto`, S4 4.9): copia el overlay del
// representante al ancla SOLO si el ancla no tiene uno. DB real (crm_test). Datos inventados.

const T = "tenant-ado"
const OTRO = "tenant-otro"

async function sembrar(id: string, o: { tipo?: string; padre?: string; opcion?: string; precio?: number; tenant?: string } = {}) {
  const precios = o.precio ? JSON.stringify([{ idPriceList: "1", name: "Online", price: o.precio }]) : "[]"
  const variante = o.opcion ? JSON.stringify([{ atributo: "Color", opcion: o.opcion }]) : null
  await getDb().execute(sql`
    INSERT INTO catalog_products (tenant_id, alegra_id, name, tipo, padre_alegra_id, variante, stock, status, alegra_status, prices, precios_online)
    VALUES (${o.tenant ?? T}, ${id}, ${"Producto " + id}, ${o.tipo ?? "simple"}, ${o.padre ?? null}, ${variante}::jsonb, 5, 'active', 'active', ${precios}::jsonb, ${precios}::jsonb)
  `)
}

async function overlay(id: string, o: { nombre?: string; visible?: boolean; ocultoEn?: string[]; tenant?: string }) {
  const tenant = o.tenant ?? T
  const filas = (await getDb().execute(sql`
    INSERT INTO catalog_overlay (tenant_id, alegra_id, nombre, visible, oculto_en_sucursales, fotos)
    VALUES (${tenant}, ${id}, ${o.nombre ?? null}, ${o.visible ?? false}, ${sql.raw(`ARRAY[${(o.ocultoEn ?? []).map((s) => `'${s}'`).join(",")}]::text[]`)},
            ${JSON.stringify([{ key: `productos/${tenant}/${id}/f-320.webp`, w: 320 }])}::jsonb)
    RETURNING id
  `)) as unknown as { id: string }[]
  return filas[0].id
}

const leerOverlay = async (id: string) =>
  (
    (await getDb().execute(
      sql`SELECT nombre, visible, oculto_en_sucursales, fotos FROM catalog_overlay WHERE tenant_id = ${T} AND alegra_id = ${id}`,
    )) as unknown as { nombre: string | null; visible: boolean; oculto_en_sucursales: string[]; fotos: { key: string }[] }[]
  )[0]

beforeEach(async () => {
  await truncateAll()
  await seedTenant(T)
  await seedTenant(OTRO)
})

afterAll(async () => {
  await truncateAll()
})

describe("adoptarOverlayEnAnclas", () => {
  it("copia el overlay del representante al padre, con etiquetas y 'oculto en', sin tocar el de las variantes", async () => {
    await sembrar("P1", { tipo: "padre" })
    await sembrar("a", { tipo: "variante", padre: "P1", opcion: "Verde", precio: 100 })
    await sembrar("b", { tipo: "variante", padre: "P1", opcion: "Rojo", precio: 200 })
    await recalcularGrupos(T) // el representante es "a" (la más barata)

    const overlayA = await overlay("a", { nombre: "Cinta LED", visible: true, ocultoEn: ["mdp"] })
    await overlay("b", { nombre: "Otro nombre", visible: false })
    const tag = (await getDb().execute(sql`INSERT INTO shop_tags (tenant_id, nombre, slug) VALUES (${T}, 'Exterior', 'exterior') RETURNING id`)) as unknown as { id: string }[]
    await getDb().execute(sql`INSERT INTO catalog_overlay_tags (overlay_id, tag_id) VALUES (${overlayA}::uuid, ${tag[0].id}::uuid)`)

    const r = await adoptarOverlayEnAnclas(T)
    expect(r).toMatchObject({ grupos: 1, conOverlay: 0, copiados: 1, sinOverlayTotal: 0 })

    expect(await leerOverlay("P1")).toMatchObject({ nombre: "Cinta LED", visible: true, oculto_en_sucursales: ["mdp"] })
    expect((await leerOverlay("P1")).fotos).toHaveLength(1)
    const tags = (await getDb().execute(sql`
      SELECT count(*)::int AS n FROM catalog_overlay_tags t JOIN catalog_overlay o ON o.id = t.overlay_id WHERE o.tenant_id = ${T} AND o.alegra_id = 'P1'
    `)) as unknown as { n: number }[]
    expect(tags[0].n).toBe(1)
    // Los de las variantes quedan como estaban.
    expect(await leerOverlay("a")).toMatchObject({ nombre: "Cinta LED", visible: true })
    expect(await leerOverlay("b")).toMatchObject({ nombre: "Otro nombre", visible: false })
  })

  it("nunca pisa un overlay que el ancla ya tiene", async () => {
    await sembrar("P1", { tipo: "padre" })
    await sembrar("a", { tipo: "variante", padre: "P1", opcion: "Verde", precio: 100 })
    await recalcularGrupos(T)
    await overlay("P1", { nombre: "Nombre del modelo", visible: false })
    await overlay("a", { nombre: "Nombre de la variante", visible: true })

    const r = await adoptarOverlayEnAnclas(T)
    expect(r).toMatchObject({ grupos: 1, conOverlay: 1, copiados: 0 })
    expect(await leerOverlay("P1")).toMatchObject({ nombre: "Nombre del modelo", visible: false })
  })

  it("si el representante no tiene overlay usa otra variante que sí lo tenga", async () => {
    await sembrar("P1", { tipo: "padre" })
    await sembrar("a", { tipo: "variante", padre: "P1", opcion: "Verde", precio: 100 })
    await sembrar("b", { tipo: "variante", padre: "P1", opcion: "Rojo", precio: 200 })
    await recalcularGrupos(T)
    await overlay("b", { nombre: "Cinta roja", visible: true })

    const r = await adoptarOverlayEnAnclas(T)
    expect(r.copiados).toBe(1)
    expect(await leerOverlay("P1")).toMatchObject({ nombre: "Cinta roja" })
  })

  it("lista los modelos en los que nadie tiene overlay (saldrían invisibles)", async () => {
    await sembrar("P1", { tipo: "padre" })
    await sembrar("a", { tipo: "variante", padre: "P1", opcion: "Verde", precio: 100 })
    await sembrar("P2", { tipo: "padre" })
    await sembrar("c", { tipo: "variante", padre: "P2", opcion: "Azul", precio: 100 })
    await recalcularGrupos(T)
    await overlay("c", { nombre: "Azul", visible: true })

    const r = await adoptarOverlayEnAnclas(T)
    expect(r).toMatchObject({ grupos: 2, copiados: 1, sinOverlayTotal: 1, sinOverlay: ["P1"] })
    expect(await leerOverlay("P1")).toBeUndefined()
  })

  it("también adopta en la base de un grupo armado a mano", async () => {
    await sembrar("A", { precio: 100 })
    await sembrar("B", { precio: 200 })
    await sumarAGrupo(T, { alegraId: "B", grupoId: "A", etiqueta: "Negro", etiquetaAncla: "Blanco" }, null)
    // El overlay de la base ya existe: no se pisa. Si no existiera, lo tomaría del otro miembro.
    await overlay("B", { nombre: "Cinta negra", visible: true })

    const r = await adoptarOverlayEnAnclas(T)
    expect(r).toMatchObject({ grupos: 1, copiados: 1 })
    expect(await leerOverlay("A")).toMatchObject({ nombre: "Cinta negra", visible: true })
  })

  it("es idempotente y respeta el tenant", async () => {
    await sembrar("P1", { tipo: "padre" })
    await sembrar("a", { tipo: "variante", padre: "P1", opcion: "Verde", precio: 100 })
    await recalcularGrupos(T)
    await overlay("a", { nombre: "Cinta", visible: true })
    await sembrar("P9", { tipo: "padre", tenant: OTRO })
    await sembrar("z", { tipo: "variante", padre: "P9", opcion: "Verde", precio: 100, tenant: OTRO })
    await recalcularGrupos(OTRO)
    await overlay("z", { nombre: "Ajeno", visible: true, tenant: OTRO })

    expect((await adoptarOverlayEnAnclas(T)).copiados).toBe(1)
    expect((await adoptarOverlayEnAnclas(T)).copiados).toBe(0)
    const ajeno = (await getDb().execute(sql`SELECT 1 FROM catalog_overlay WHERE tenant_id = ${OTRO} AND alegra_id = 'P9'`)) as unknown as unknown[]
    expect(ajeno).toHaveLength(0)
  })

  it("dentro de una transacción que se deshace (ensayo) no queda nada escrito", async () => {
    await sembrar("P1", { tipo: "padre" })
    await sembrar("a", { tipo: "variante", padre: "P1", opcion: "Verde", precio: 100 })
    await recalcularGrupos(T)
    await overlay("a", { nombre: "Cinta", visible: true })

    class Ensayo extends Error {}
    let copiados = -1
    await getDb()
      .transaction(async (tx) => {
        copiados = (await adoptarOverlayEnAnclas(T, tx)).copiados
        throw new Ensayo()
      })
      .catch((e) => {
        if (!(e instanceof Ensayo)) throw e
      })
    expect(copiados).toBe(1)
    expect(await leerOverlay("P1")).toBeUndefined()
  })
})
