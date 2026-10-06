import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { listaPrecioAlegraMapeo, listasPrecioOnline, preciosOnlineCambios } from "@/db/schema"
import type { CambioPrecios } from "@/lib/precios-online-cambios"
import {
  PreciosOnlineError,
  aplicarCambios,
  aplicarReversion,
  listarListas,
  listarListasAlegra,
  previsualizar,
  previsualizarReversion,
} from "@/lib/precios-online-repo"
import { seedTenant, truncateAll } from "./helpers"
import { aplicar as recalcular, seedLista, seedProducto } from "./precios-online-helpers"

// Admin de las listas privadas (change `listas-cuenta-corriente`, rebanada A): marcar privada, enlazar
// con la lista de Alegra, validaciones en usted, auditoría y reversa; todo por el camino real
// (vista previa + aplicar). Datos inventados.

const T = "tenant-lpc"
const OTRO = "tenant-otro"
const USUARIO = { id: "u1", name: "Ana", email: "ana@cliente.example" }

async function aplicar(cambios: CambioPrecios[], tenant = T) {
  const previa = await previsualizar(tenant, cambios)
  return aplicarCambios(tenant, USUARIO, { cambios, baseVersion: previa.baseVersion, huella: previa.huella, confirmaExtra: true })
}

async function falla(p: Promise<unknown>): Promise<PreciosOnlineError> {
  try {
    await p
  } catch (e) {
    if (e instanceof PreciosOnlineError) return e
    throw e
  }
  throw new Error("se esperaba un PreciosOnlineError")
}

async function privados(alegraId = "1") {
  const [r] = (await getDb().execute(sql`
    SELECT precios_online AS pub, precios_online_privados AS priv FROM catalog_products WHERE tenant_id = ${T} AND alegra_id = ${alegraId}
  `)) as unknown as { pub: { name: string }[]; priv: { name: string; price: number }[] }[]
  return r
}

async function cambiosDe(tipo: string) {
  return getDb().select().from(preciosOnlineCambios).where(eq(preciosOnlineCambios.tipo, tipo))
}

let ref: string

beforeEach(async () => {
  await truncateAll()
  await seedTenant(T)
  await seedTenant(OTRO)
  ref = await seedLista(T, "Lista A", "1.6", { esReferencia: true, orden: 1 })
  await seedProducto(T, { alegraId: "1", costo: "100" })
})
afterAll(async () => {
  await truncateAll()
})

describe("marcar una lista como privada", () => {
  it("al aplicar, su precio sale de precios_online y pasa a precios_online_privados", async () => {
    const l = await seedLista(T, "Lista L5", "1.2", { orden: 2 })
    await aplicar([{ op: "editarLista", listaId: l, nombre: "Lista L5", coeficiente: "1.3" }]) // recalcula: pública
    expect((await privados()).pub.map((e) => e.name)).toEqual(["Lista A", "Lista L5"])
    await aplicar([{ op: "editarLista", listaId: l, privada: true }])
    const r = await privados()
    expect(r.pub.map((e) => e.name)).toEqual(["Lista A"])
    expect(r.priv).toEqual([expect.objectContaining({ name: "Lista L5", price: 130 })])
  })

  it("la vista previa no cuenta como cambio de precio lo que solo cambia de columna", async () => {
    const l = await seedLista(T, "Lista L5", "1.2", { orden: 2 })
    await aplicar([{ op: "editarLista", listaId: l, nombre: "Lista L5", coeficiente: "1.25" }])
    const previa = await previsualizar(T, [{ op: "editarLista", listaId: l, privada: true }])
    expect(previa).toMatchObject({ productosAfectados: 0, suben: 0, bajan: 0, nuevos: 0, quitan: 0 })
  })

  it("crear una lista ya privada: su precio va directo a las privadas", async () => {
    await aplicar([{ op: "crearLista", nombre: "Lista L5", coeficiente: "1.2", privada: true }])
    const r = await privados()
    expect(r.pub.map((e) => e.name)).toEqual(["Lista A"])
    expect(r.priv.map((e) => e.name)).toEqual(["Lista L5"])
  })

  it("la primera lista del tenant (la referencia) no puede crearse privada", async () => {
    const e = await falla(previsualizar(OTRO, [{ op: "crearLista", nombre: "Lista L5", coeficiente: "1.2", privada: true }]))
    expect(e).toMatchObject({ status: 422, code: "referencia_privada" })
    expect(e.message).toBe("La lista de referencia no puede ser privada.")
  })

  it("la lista de referencia no puede marcarse privada", async () => {
    const e = await falla(previsualizar(T, [{ op: "editarLista", listaId: ref, privada: true }]))
    expect(e).toMatchObject({ status: 422, code: "referencia_privada", message: "La lista de referencia no puede ser privada." })
  })

  it("una lista enlazada a un medio de pago no puede marcarse privada", async () => {
    const l = await seedLista(T, "Lista B", "1.3", { orden: 2 })
    await getDb().execute(sql`INSERT INTO medios_pago_shop (tenant_id, slug, nombre) VALUES (${T}, 'efectivo', 'Efectivo')`)
    await aplicar([{ op: "setCondicion", medioSlug: "efectivo", cuotas: null, listaId: l }])
    const e = await falla(previsualizar(T, [{ op: "editarLista", listaId: l, privada: true }]))
    expect(e).toMatchObject({ status: 422, code: "lista_en_uso" })
    expect(e.message).toBe("Una lista enlazada a un medio de pago no puede ser privada. Quite el enlace primero.")
  })

  it("una lista privada no puede enlazarse a un medio de pago", async () => {
    const priv = await seedLista(T, "Lista L5", "1.2", { orden: 2, privada: true })
    await getDb().execute(sql`INSERT INTO medios_pago_shop (tenant_id, slug, nombre) VALUES (${T}, 'efectivo', 'Efectivo')`)
    const e = await falla(previsualizar(T, [{ op: "setCondicion", medioSlug: "efectivo", cuotas: null, listaId: priv }]))
    expect(e).toMatchObject({ status: 422, code: "lista_privada" })
    expect(e.message).toBe("Una lista privada no puede enlazarse a un medio de pago.")
  })

  it("queda auditado: lista_edicion con `privada` antes y después, y se puede revertir", async () => {
    const l = await seedLista(T, "Lista L5", "1.2", { orden: 2 })
    await aplicar([{ op: "editarLista", listaId: l, privada: true }])
    const [e] = await cambiosDe("lista_edicion")
    expect(e.antes).toMatchObject({ privada: false })
    expect(e.despues).toMatchObject({ privada: true })
    const { resultado } = await previsualizarReversion(T, e.id)
    await aplicarReversion(T, USUARIO, e.id, { baseVersion: resultado.baseVersion, huella: resultado.huella })
    expect((await privados()).priv).toEqual([])
    expect((await privados()).pub.map((x) => x.name)).toEqual(["Lista A", "Lista L5"])
  })
})

describe("enlazar con la lista de Alegra (setMapeo)", () => {
  let priv: string
  beforeEach(async () => {
    priv = await seedLista(T, "Lista L5", "1.2", { orden: 2, privada: true })
  })
  const enlazar = (extra: Partial<Extract<CambioPrecios, { op: "setMapeo" }>> = {}) =>
    aplicar([{ op: "setMapeo", alegraAccount: "principal", alegraPriceListId: "5", listaId: priv, ...extra }])

  it("crea el enlace y lo audita (tipo 'mapeo', objeto por cuenta y lista de Alegra)", async () => {
    await enlazar()
    expect(await getDb().select().from(listaPrecioAlegraMapeo)).toEqual([
      expect.objectContaining({ tenantId: T, alegraAccount: "principal", alegraPriceListId: "5", listaId: priv, privada: true }),
    ])
    const [e] = await cambiosDe("mapeo")
    expect(e.objeto).toBe("mapeo:principal:5")
    expect(e.antes).toMatchObject({ listaId: null })
    expect(e.despues).toMatchObject({ alegraAccount: "principal", alegraPriceListId: "5", listaId: priv })
  })

  it("no cambia ningún precio ni columna de precios", async () => {
    await recalcular(T, null, "config") // los precios ya materializados: el enlace no los toca
    const antes = await privados()
    const previa = await previsualizar(T, [{ op: "setMapeo", alegraAccount: "principal", alegraPriceListId: "5", listaId: priv }])
    expect(previa.productosAfectados).toBe(0)
    await enlazar()
    expect(await privados()).toEqual(antes)
  })

  it("solo una lista privada puede enlazarse", async () => {
    const e = await falla(previsualizar(T, [{ op: "setMapeo", alegraAccount: "principal", alegraPriceListId: "5", listaId: ref }]))
    expect(e).toMatchObject({ status: 422, code: "lista_no_privada" })
    expect(e.message).toBe("Solo una lista privada puede enlazarse con una lista de Alegra.")
  })

  it("una lista de otro tenant no existe", async () => {
    const ajena = await seedLista(OTRO, "Lista X", "1.2", { esReferencia: true })
    expect(await falla(previsualizar(T, [{ op: "setMapeo", alegraAccount: "principal", alegraPriceListId: "5", listaId: ajena }]))).toMatchObject({
      status: 404,
      code: "lista_no_existe",
    })
  })

  it("repetir el mismo enlace no es un cambio; mover la lista de Alegra a otra lista online sí", async () => {
    await enlazar()
    expect(await falla(previsualizar(T, [{ op: "setMapeo", alegraAccount: "principal", alegraPriceListId: "5", listaId: priv }]))).toMatchObject({
      status: 422,
      code: "sin_cambios",
    })
    const otra = await seedLista(T, "Lista L6", "1.1", { orden: 3, privada: true })
    await enlazar({ listaId: otra })
    const filas = await getDb().select().from(listaPrecioAlegraMapeo)
    expect(filas).toHaveLength(1)
    expect(filas[0].listaId).toBe(otra)
  })

  it("quitar el enlace (listaId null) lo borra, lo audita y falla si no existía", async () => {
    expect(await falla(previsualizar(T, [{ op: "setMapeo", alegraAccount: "principal", alegraPriceListId: "5", listaId: null }]))).toMatchObject({
      status: 422,
      code: "sin_cambios",
    })
    await enlazar()
    await enlazar({ listaId: null })
    expect(await getDb().select().from(listaPrecioAlegraMapeo)).toEqual([])
    expect(await cambiosDe("mapeo")).toHaveLength(2)
  })

  it("se puede revertir el alta del enlace (lo borra)", async () => {
    await enlazar()
    const [alta] = await cambiosDe("mapeo")
    const { resultado } = await previsualizarReversion(T, alta.id)
    await aplicarReversion(T, USUARIO, alta.id, { baseVersion: resultado.baseVersion, huella: resultado.huella })
    expect(await getDb().select().from(listaPrecioAlegraMapeo)).toEqual([])
  })

  it("la misma lista de Alegra puede enlazarse en dos cuentas distintas", async () => {
    await enlazar()
    await enlazar({ alegraAccount: "mdp" })
    expect(await getDb().select().from(listaPrecioAlegraMapeo)).toHaveLength(2)
  })

  it("volver pública una lista con enlaces quita los enlaces (cada uno queda auditado)", async () => {
    await enlazar()
    await enlazar({ alegraPriceListId: "6" })
    await aplicar([{ op: "editarLista", listaId: priv, privada: false }])
    expect(await getDb().select().from(listaPrecioAlegraMapeo)).toEqual([])
    expect(await cambiosDe("mapeo")).toHaveLength(4) // 2 altas + 2 bajas
    expect((await privados()).pub.map((e) => e.name)).toEqual(["Lista A", "Lista L5"])
  })

  it("borrar la lista privada borra sus enlaces y la baja queda auditada con ellos", async () => {
    await enlazar()
    await aplicar([{ op: "borrarLista", listaId: priv }])
    expect(await getDb().select().from(listaPrecioAlegraMapeo)).toEqual([])
    const [baja] = await cambiosDe("lista_baja")
    expect(baja.antes).toMatchObject({ privada: true, mapeos: [{ alegraAccount: "principal", alegraPriceListId: "5" }] })
  })

  it("revertir la baja de una lista privada la restaura privada y con sus enlaces", async () => {
    await enlazar()
    await aplicar([{ op: "borrarLista", listaId: priv }])
    const [baja] = await cambiosDe("lista_baja")
    const { resultado } = await previsualizarReversion(T, baja.id)
    await aplicarReversion(T, USUARIO, baja.id, { baseVersion: resultado.baseVersion, huella: resultado.huella })
    const [l] = await getDb().select().from(listasPrecioOnline).where(eq(listasPrecioOnline.id, priv))
    expect(l.privada).toBe(true)
    expect(await getDb().select().from(listaPrecioAlegraMapeo)).toEqual([expect.objectContaining({ listaId: priv, alegraPriceListId: "5" })])
    expect((await privados()).priv.map((e) => e.name)).toEqual(["Lista L5"])
  })
})

describe("lecturas del admin", () => {
  it("listarListas trae `privada` y sus enlaces", async () => {
    const priv = await seedLista(T, "Lista L5", "1.2", { orden: 2, privada: true })
    await aplicar([{ op: "setMapeo", alegraAccount: "principal", alegraPriceListId: "5", listaId: priv }])
    const listas = await listarListas(T)
    expect(listas.map((l) => [l.nombre, l.privada])).toEqual([
      ["Lista A", false],
      ["Lista L5", true],
    ])
    expect(listas[0].mapeos).toEqual([])
    expect(listas[1].mapeos).toEqual([expect.objectContaining({ alegraAccount: "principal", alegraPriceListId: "5" })])
  })

  it("listarListasAlegra: las listas de Alegra salen de los contactos del espejo, por cuenta (price_lists es de Excel, no de Alegra)", async () => {
    await getDb().execute(sql`
      INSERT INTO alegra_contacts (tenant_id, alegra_account, alegra_id, name, price_list_id, price_list_name, status)
      VALUES (${T}, 'principal', 'c1', 'Cliente Uno', '5', 'Mayorista L5', 'active'),
             (${T}, 'principal', 'c2', 'Cliente Dos', '5', 'Mayorista L5', 'active'),
             (${T}, 'principal', 'c3', 'Cliente Tres', '7', 'Distribuidor', 'active'),
             (${T}, 'principal', 'c4', 'Cliente Baja', '9', 'Vieja', 'inactive'),
             (${T}, 'principal', 'c5', 'Sin lista', NULL, NULL, 'active'),
             (${T}, 'mdp', 'c1', 'Cliente MDP', '5', 'Lista cinco MDP', 'active'),
             (${OTRO}, 'principal', 'c1', 'Ajeno', '88', 'Ajena', 'active')
    `)
    const r = await listarListasAlegra(T)
    expect(r.filter((x) => x.alegraAccount === "principal").map((x) => [x.alegraPriceListId, x.nombre, x.contactos])).toEqual([
      ["5", "Mayorista L5", 2],
      ["7", "Distribuidor", 1],
    ])
    expect(r.filter((x) => x.alegraAccount === "mdp").map((x) => [x.alegraPriceListId, x.nombre, x.contactos])).toEqual([["5", "Lista cinco MDP", 1]])
    expect(JSON.stringify(r)).not.toContain("Ajena")
  })

  it("listarListasAlegra suma los enlaces cuya lista de Alegra ya no tiene contactos (para poder quitarlos)", async () => {
    const priv = await seedLista(T, "Lista L5", "1.2", { orden: 2, privada: true })
    await aplicar([{ op: "setMapeo", alegraAccount: "principal", alegraPriceListId: "42", listaId: priv }])
    expect(await listarListasAlegra(T)).toEqual([expect.objectContaining({ alegraAccount: "principal", alegraPriceListId: "42", contactos: 0 })])
  })
})
