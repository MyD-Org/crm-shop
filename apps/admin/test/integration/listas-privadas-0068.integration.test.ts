import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { listaPrecioAlegraMapeo, listaPrecioCondiciones, listasPrecioOnline } from "@/db/schema"
import { seedTenant, truncateAll } from "./helpers"
import { aplicar, calcular, seedLista, seedOverrideMarca, seedProducto } from "./precios-online-helpers"

// Migración 0068 (change `listas-cuenta-corriente`, rebanada A): lista privada, enlace con la lista
// de Alegra y precios privados materializados aparte. `calcular_precios_online` no cambia (sigue
// siendo el oráculo de TODAS las listas activas); `aplicar_precios_online` separa públicas y
// privadas. Datos inventados.

const T = "tenant-lp"
const OTRO = "tenant-otro"

interface Entrada {
  idPriceList: string
  name: string
  price: number
  main?: boolean
}
interface Fila {
  alegra_id: string
  precios_online: Entrada[]
  precios_online_privados: Entrada[]
  precio_online_ref: string | null
}

async function filas(tenant = T): Promise<Record<string, Fila>> {
  const rows = (await getDb().execute(sql`
    SELECT alegra_id, precios_online, precios_online_privados, precio_online_ref
    FROM catalog_products WHERE tenant_id = ${tenant} ORDER BY alegra_id
  `)) as unknown as Fila[]
  return Object.fromEntries(rows.map((r) => [r.alegra_id, r]))
}

/** Código SQLSTATE de un error de la base (drizzle lo envuelve: el original está en `cause`). */
async function codigo(p: Promise<unknown>): Promise<string | null> {
  try {
    await p
    return null
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } }
    return err.cause?.code ?? err.code ?? "?"
  }
}

beforeEach(async () => {
  await truncateAll()
  await seedTenant(T)
  await seedTenant(OTRO)
})
afterAll(async () => {
  await truncateAll()
})

describe("aplicar_precios_online separa las listas públicas de las privadas", () => {
  it("la pública va a precios_online y la privada SOLO a precios_online_privados", async () => {
    const pub = await seedLista(T, "Lista A", "1.6", { esReferencia: true, orden: 1 })
    const priv = await seedLista(T, "Lista L5", "1.2", { orden: 2, privada: true })
    await seedProducto(T, { alegraId: "1", costo: "100" })
    await aplicar(T, null, "config")
    const f = (await filas())["1"]
    expect(f.precios_online).toEqual([{ idPriceList: pub, name: "Lista A", price: 160, main: true }])
    expect(f.precios_online_privados).toEqual([{ idPriceList: priv, name: "Lista L5", price: 120 }])
    expect(f.precio_online_ref).toBe("160.00")
  })

  it("costo NULL o <= 0: la lista privada no emite entrada (nunca precio 0)", async () => {
    await seedLista(T, "Lista A", "1.6", { esReferencia: true })
    await seedLista(T, "Lista L5", "1.2", { privada: true })
    await seedProducto(T, { alegraId: "sin", costo: null })
    await seedProducto(T, { alegraId: "cero", costo: "0" })
    await aplicar(T, null, "config")
    const f = await filas()
    expect(f.sin.precios_online_privados).toEqual([])
    expect(f.cero.precios_online_privados).toEqual([])
  })

  it("una lista privada inactiva no emite precios", async () => {
    await seedLista(T, "Lista A", "1.6", { esReferencia: true })
    await seedLista(T, "Lista L5", "1.2", { privada: true, activa: false })
    await seedProducto(T, { alegraId: "1", costo: "100" })
    await aplicar(T, null, "config")
    expect((await filas())["1"].precios_online_privados).toEqual([])
  })

  it("pasar una lista de pública a privada (y a la inversa) reescribe las dos columnas en el mismo recálculo", async () => {
    await seedLista(T, "Lista A", "1.6", { esReferencia: true, orden: 1 })
    const l = await seedLista(T, "Lista B", "1.3", { orden: 2 })
    await seedProducto(T, { alegraId: "1", costo: "100" })
    await aplicar(T, null, "config")
    let f = (await filas())["1"]
    expect(f.precios_online.map((e) => e.name)).toEqual(["Lista A", "Lista B"])
    expect(f.precios_online_privados).toEqual([])

    await getDb().update(listasPrecioOnline).set({ privada: true }).where(sql`id = ${l}`)
    await aplicar(T, null, "config")
    f = (await filas())["1"]
    expect(f.precios_online.map((e) => e.name)).toEqual(["Lista A"])
    expect(f.precios_online_privados).toEqual([{ idPriceList: l, name: "Lista B", price: 130 }])

    await getDb().update(listasPrecioOnline).set({ privada: false }).where(sql`id = ${l}`)
    await aplicar(T, null, "config")
    f = (await filas())["1"]
    expect(f.precios_online.map((e) => e.name)).toEqual(["Lista A", "Lista B"])
    expect(f.precios_online_privados).toEqual([])
  })

  it("el cálculo de la privada es el mismo (costo_aplicado x coeficiente efectivo, con ajustes)", async () => {
    await seedLista(T, "Lista A", "1.6", { esReferencia: true })
    const priv = await seedLista(T, "Lista L5", "1.2", { privada: true })
    await seedProducto(T, { alegraId: "1", costo: "100", brand: "acme" })
    await seedOverrideMarca(T, priv, "acme", "1.5")
    const c = (await calcular(T)).find((r) => r.lista_id === priv)!
    expect(c).toMatchObject({ origen: "marca:acme", precio: "150.00" })
    await aplicar(T, null, "config")
    expect((await filas())["1"].precios_online_privados[0]).toEqual({
      idPriceList: priv,
      name: "Lista L5",
      price: Number(c.precio),
    })
  })

  it("en modo 'costo' aplica y retiene igual, y mantiene las privadas al día", async () => {
    await seedLista(T, "Lista A", "1.6", { esReferencia: true })
    await seedLista(T, "Lista L5", "1.2", { privada: true })
    await seedProducto(T, { alegraId: "1", costo: "100" })
    await aplicar(T, null, "config")
    await getDb().execute(sql`UPDATE catalog_products SET costo = 105 WHERE tenant_id = ${T}`)
    await aplicar(T, null, "costo")
    const f = (await filas())["1"]
    expect(f.precios_online[0].price).toBe(168)
    expect(f.precios_online_privados[0].price).toBe(126)
  })

  it("aplicar sobre ids acotados no toca otros productos ni otros tenants", async () => {
    await seedLista(T, "Lista A", "1.6", { esReferencia: true })
    await seedLista(T, "Lista L5", "1.2", { privada: true })
    await seedLista(OTRO, "Lista A", "1.6", { esReferencia: true })
    await seedLista(OTRO, "Lista L5", "1.2", { privada: true })
    await seedProducto(T, { alegraId: "1", costo: "100" })
    await seedProducto(T, { alegraId: "2", costo: "200" })
    await seedProducto(OTRO, { alegraId: "1", costo: "300" })
    await aplicar(T, ["1"], "config")
    expect((await filas())["1"].precios_online_privados).toHaveLength(1)
    expect((await filas())["2"].precios_online_privados).toEqual([])
    expect((await filas(OTRO))["1"].precios_online_privados).toEqual([])
  })
})

describe("restricciones de la lista privada y del enlace", () => {
  it("una lista referencia no puede ser privada (CHECK)", async () => {
    const ref = await seedLista(T, "Lista A", "1.6", { esReferencia: true })
    expect(await codigo(getDb().update(listasPrecioOnline).set({ privada: true }).where(sql`id = ${ref}`))).toBe("23514")
  })

  it("una lista con condiciones de medio no puede pasar a privada (trigger)", async () => {
    await seedLista(T, "Lista A", "1.6", { esReferencia: true })
    const l = await seedLista(T, "Lista B", "1.3")
    await getDb().execute(sql`
      INSERT INTO medios_pago_shop (tenant_id, slug, nombre, orden, activo) VALUES (${T}, 'efectivo', 'Efectivo', 1, true)
    `)
    await getDb().insert(listaPrecioCondiciones).values({ tenantId: T, listaId: l, medioSlug: "efectivo", cuotas: null })
    expect(await codigo(getDb().update(listasPrecioOnline).set({ privada: true }).where(sql`id = ${l}`))).toBe("23514")
  })

  it("una lista privada no puede recibir una condición de medio (trigger)", async () => {
    await seedLista(T, "Lista A", "1.6", { esReferencia: true })
    const priv = await seedLista(T, "Lista L5", "1.2", { privada: true })
    await getDb().execute(sql`
      INSERT INTO medios_pago_shop (tenant_id, slug, nombre, orden, activo) VALUES (${T}, 'efectivo', 'Efectivo', 1, true)
    `)
    expect(
      await codigo(getDb().insert(listaPrecioCondiciones).values({ tenantId: T, listaId: priv, medioSlug: "efectivo", cuotas: null })),
    ).toBe("23514")
  })

  it("el enlace solo admite listas privadas del mismo tenant", async () => {
    await seedLista(T, "Lista A", "1.6", { esReferencia: true })
    const pub = await seedLista(T, "Lista B", "1.3")
    const priv = await seedLista(T, "Lista L5", "1.2", { privada: true })
    const ajena = await seedLista(OTRO, "Lista X", "1.2", { privada: true })
    const ins = (listaId: string, alegraPriceListId: string, tenantId = T) =>
      getDb().insert(listaPrecioAlegraMapeo).values({ tenantId, alegraAccount: "principal", alegraPriceListId, listaId })
    expect(await codigo(ins(pub, "5"))).toBe("23503") // pública: la FK compuesta no la encuentra
    expect(await codigo(ins(ajena, "5"))).toBe("23503") // de otro tenant
    expect(await codigo(ins(priv, "5"))).toBeNull()
  })

  it("la lista de Alegra apunta a UNA sola lista online por (tenant, cuenta); otra cuenta puede repetir el id", async () => {
    await seedLista(T, "Lista A", "1.6", { esReferencia: true })
    const a = await seedLista(T, "Lista L5", "1.2", { privada: true })
    const b = await seedLista(T, "Lista L6", "1.1", { privada: true })
    const ins = (cuenta: string, lista: string, id = "5") =>
      getDb().insert(listaPrecioAlegraMapeo).values({ tenantId: T, alegraAccount: cuenta, alegraPriceListId: id, listaId: lista })
    expect(await codigo(ins("principal", a))).toBeNull()
    expect(await codigo(ins("principal", b))).toBe("23505")
    expect(await codigo(ins("mdp", b))).toBeNull() // misma lista de Alegra, otra cuenta
    expect(await codigo(ins("principal", a, "6"))).toBeNull() // una lista online puede tener varias filas
  })

  it("una lista con enlaces no puede volver a ser pública sin quitar los enlaces (FK)", async () => {
    await seedLista(T, "Lista A", "1.6", { esReferencia: true })
    const priv = await seedLista(T, "Lista L5", "1.2", { privada: true })
    await getDb().insert(listaPrecioAlegraMapeo).values({ tenantId: T, alegraAccount: "principal", alegraPriceListId: "5", listaId: priv })
    expect(await codigo(getDb().update(listasPrecioOnline).set({ privada: false }).where(sql`id = ${priv}`))).toBe("23503")
  })

  it("borrar la lista borra sus enlaces (cascada)", async () => {
    await seedLista(T, "Lista A", "1.6", { esReferencia: true })
    const priv = await seedLista(T, "Lista L5", "1.2", { privada: true })
    await getDb().insert(listaPrecioAlegraMapeo).values({ tenantId: T, alegraAccount: "principal", alegraPriceListId: "5", listaId: priv })
    await getDb().delete(listasPrecioOnline).where(sql`id = ${priv}`)
    expect(await getDb().select().from(listaPrecioAlegraMapeo)).toEqual([])
  })

  it("precios_online_cambios admite el tipo 'mapeo'", async () => {
    const r = getDb().execute(sql`
      INSERT INTO precios_online_cambios (tenant_id, tipo, objeto, usuario) VALUES (${T}, 'mapeo', 'mapeo:principal:5', 'ana@cliente.example')
    `)
    expect(await codigo(r)).toBeNull()
  })
})
