import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import {
  catalogProducts,
  listaPrecioOverrides,
  listasPrecioOnline,
  preciosOnlineRetenciones,
} from "@/db/schema"
import type { CambioPrecios } from "@/lib/precios-online-cambios"
import {
  PreciosOnlineError,
  aplicarCambios,
  aplicarReversion,
  leerConfig,
  listarHistorial,
  listarListas,
  previsualizar,
  previsualizarReversion,
  type UsuarioActor,
} from "@/lib/precios-online-repo"
import {
  aprobarRetenidos,
  contarAlertas,
  listarRetenidos,
  recalcularPreciosItems,
  recalcularTodos,
  rechazarRetenidos,
} from "@/lib/precios-online-costos"
import { seedTenant, truncateAll } from "./helpers"
import { calcular, seedCategoria, seedLista, seedOverrideMarca, seedProducto } from "./precios-online-helpers"

// B.9–B.15: vista previa, aplicar atómico con historial, confirmación extra, reglas de lista,
// revertir, retenidos y concurrencia. Contra Postgres real (crm_test). Datos inventados.

const T = "tenant-po"
const OTRO = "tenant-otro"
const ANA: UsuarioActor = { id: "u1", name: "Ana Admin", email: "ana.admin@example.com" }

beforeEach(async () => {
  await truncateAll()
  await seedTenant(T)
  await seedTenant(OTRO)
})
afterAll(async () => {
  await truncateAll()
})

/** Previa -> aplicar, como lo hace la UI. */
async function previaYAplicar(cambios: CambioPrecios[], extra: { confirmaExtra?: boolean; tenant?: string } = {}) {
  const tenant = extra.tenant ?? T
  const p = await previsualizar(tenant, cambios)
  const r = await aplicarCambios(tenant, ANA, { cambios, baseVersion: p.baseVersion, huella: p.huella, confirmaExtra: extra.confirmaExtra })
  return { previa: p, aplicado: r }
}

const crear = (nombre: string, coeficiente: string): CambioPrecios => ({ op: "crearLista", nombre, coeficiente })
const fila = async (alegraId: string) => (await getDb().select().from(catalogProducts).where(eq(catalogProducts.alegraId, alegraId)))[0]
const error = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e as PreciosOnlineError
  }
  throw new Error("no falló")
}

describe("vista previa", () => {
  it("no escribe precios, historial, listas ni versión", async () => {
    await seedLista(T, "Lista A", "1.5", { esReferencia: true })
    await seedProducto(T, { alegraId: "1", costo: "100" })
    await recalcularTodos(T) // deja precios vigentes que la previa no debe tocar
    const listasAntes = await listarListas(T)
    const historialAntes = await listarHistorial(T, { start: 0, limit: 50 })
    const cfgAntes = await leerConfig(T)
    const precioAntes = (await fila("1")).preciosOnline

    const p = await previsualizar(T, [{ op: "editarLista", listaId: listasAntes[0].id, coeficiente: "1.9" }, crear("Lista B", "1.2")])
    expect(p.productosAfectados).toBe(1)

    expect(await listarListas(T)).toEqual(listasAntes)
    expect((await listarHistorial(T, { start: 0, limit: 50 })).total).toBe(historialAntes.total)
    expect(await leerConfig(T)).toEqual(cfgAntes)
    expect((await fila("1")).preciosOnline).toEqual(precioAntes)
  })

  it("resumen: afectados, suben/bajan, mayor suba/baja (monto y %), sin costo excluidos", async () => {
    const a = await seedLista(T, "Lista A", "2", { esReferencia: true })
    await seedLista(T, "Lista B", "1.5")
    await seedProducto(T, { alegraId: "p1", costo: "100" })
    await seedProducto(T, { alegraId: "p2", costo: "200" })
    await seedProducto(T, { alegraId: "p3", costo: null })
    await seedProducto(T, { alegraId: "p4", costo: "0", costoAplicado: "0" })
    await previaYAplicar([crear("Base", "1.1")]) // arma precios_online vía config (primera carga)
    const base = (await listarListas(T)).find((l) => l.nombre === "Base")!
    expect(base).toBeDefined()
    // Sube A de 2 a 2,2 (+10 %) y baja B de 1,5 a 1,4 (-6,67 %)
    const b = (await listarListas(T)).find((l) => l.nombre === "Lista B")!
    const p = await previsualizar(T, [
      { op: "editarLista", listaId: a, coeficiente: "2.2" },
      { op: "editarLista", listaId: b.id, coeficiente: "1.4" },
    ])
    expect(p.productosAfectados).toBe(2)
    expect(p.suben).toBe(2)
    expect(p.bajan).toBe(2)
    expect(p.mayorSubaPct).toBe(10)
    expect(p.mayorBajaPct).toBe(-6.67)
    expect(p.mayorSubaMonto).toBe("40.00") // 200 -> 220 (p2: costo 200)... lista A: 400 -> 440
    expect(p.mayorBajaMonto).toBe("-20.00") // lista B p2: 300 -> 280
    expect(p.sinPrecio).toBe(2) // p3 (NULL) y p4 (0)
    expect(p.requiereConfirmacionExtra).toBe(false)
    expect(p.muestra.length).toBeLessThanOrEqual(50)
    expect(p.muestra[0]).toMatchObject({ alegraId: "p2", listaNombre: "Lista A", antes: "400.00", despues: "440.00", variacionPct: 10 })
  })

  it("primera carga: precio nuevo sin variación que medir ni confirmación extra", async () => {
    await seedProducto(T, { alegraId: "1", costo: "100" })
    const p = await previsualizar(T, [crear("Lista A", "1.5")])
    expect(p).toMatchObject({ productosAfectados: 1, nuevos: 1, suben: 0, bajan: 0, mayorSubaPct: null, requiereConfirmacionExtra: false })
    expect(p.muestra[0]).toMatchObject({ antes: null, despues: "150.00", variacionPct: null })
  })

  it("advierte (sin bloquear) si una lista queda más cara que la referencia (DC2)", async () => {
    await seedLista(T, "Referencia", "1.5", { esReferencia: true })
    await seedProducto(T, { alegraId: "1", costo: "100" })
    await seedProducto(T, { alegraId: "2", costo: "100" })
    const p = await previsualizar(T, [crear("Cara", "1.9")])
    expect(p.advertencias.listaSuperaReferencia).toBe(2)
    // No bloquea: se puede aplicar.
    await expect(aplicarCambios(T, ANA, { cambios: [crear("Cara", "1.9")], baseVersion: p.baseVersion, huella: p.huella })).resolves.toBeDefined()
  })

  it("la muestra no pasa de 50 filas", async () => {
    await seedLista(T, "Lista A", "1.5", { esReferencia: true })
    for (let i = 0; i < 60; i++) await seedProducto(T, { alegraId: `p${i}`, costo: `${10 + i}` })
    const p = await previsualizar(T, [crear("Lista B", "1.2")])
    expect(p.productosAfectados).toBe(60)
    expect(p.muestra).toHaveLength(50)
  })

  it("un override de marca que supera el umbral se detecta en la previa", async () => {
    const lista = await seedLista(T, "Lista A", "1.5", { esReferencia: true })
    await seedProducto(T, { alegraId: "1", costo: "100", brand: "Marca X" })
    await recalcularTodos(T)
    const p = await previsualizar(T, [{ op: "upsertOverride", listaId: lista, tipo: "marca", marca: "MARCA X", coeficiente: "2" }])
    expect(p.requiereConfirmacionExtra).toBe(true) // 150 -> 200 = 33,33 %
  })
})

describe("aplicar", () => {
  it("escribe precios, historial (usuario, antes/después, afectados) y sube la versión", async () => {
    await seedProducto(T, { alegraId: "1", costo: "100" })
    const { aplicado } = await previaYAplicar([crear("Lista A", "1.5")])
    expect(aplicado.version).toBe(1)
    const p = await fila("1")
    expect(p.precioOnlineRef).toBe("150.00") // la primera lista es la referencia
    const { items } = await listarHistorial(T, { start: 0, limit: 10 })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ tipo: "lista_alta", usuario: "ana.admin@example.com", versionConfig: 1, antes: null })
    expect(items[0].resumen).toMatchObject({ productosAfectados: 1 })
    expect(items[0].despues).toMatchObject({ nombre: "Lista A", coeficiente: "1.5000", esReferencia: true })
    expect((await leerConfig(T)).version).toBe(1)
  })

  it("una previa vieja (versión distinta) se rechaza con 409", async () => {
    await seedProducto(T, { alegraId: "1", costo: "100" })
    const cambios = [crear("Lista A", "1.5")]
    const p = await previsualizar(T, cambios)
    await previaYAplicar([crear("Otra", "1.3")]) // alguien cambia el estado antes
    const e = await error(aplicarCambios(T, ANA, { cambios, baseVersion: p.baseVersion, huella: p.huella }))
    expect(e).toMatchObject({ status: 409, code: "previa_vencida", message: "La vista previa quedó desactualizada. Genere una nueva." })
  })

  it("una previa con la huella desfasada (cambió un costo entre la previa y el aplicar) se rechaza con 409", async () => {
    await seedLista(T, "Lista A", "1.5", { esReferencia: true })
    await seedProducto(T, { alegraId: "1", costo: "100" })
    const cambios: CambioPrecios[] = [crear("Lista B", "1.2")]
    const p = await previsualizar(T, cambios)
    await getDb().update(catalogProducts).set({ costoAplicado: "200" })
    const e = await error(aplicarCambios(T, ANA, { cambios, baseVersion: p.baseVersion, huella: p.huella }))
    expect(e).toMatchObject({ status: 409, code: "previa_vencida" })
    // Y una huella de otros cambios tampoco sirve.
    const p2 = await previsualizar(T, cambios)
    const e2 = await error(aplicarCambios(T, ANA, { cambios: [crear("Lista C", "1.2")], baseVersion: p2.baseVersion, huella: p2.huella }))
    expect(e2).toMatchObject({ status: 409 })
  })

  it("dos aplicar sobre la misma previa: el segundo es 409 (concurrencia)", async () => {
    await seedProducto(T, { alegraId: "1", costo: "100" })
    const cambios = [crear("Lista A", "1.5")]
    const p = await previsualizar(T, cambios)
    const entrada = { cambios, baseVersion: p.baseVersion, huella: p.huella }
    const resultados = await Promise.allSettled([aplicarCambios(T, ANA, entrada), aplicarCambios(T, ANA, entrada)])
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    const rechazado = resultados.find((r) => r.status === "rejected") as PromiseRejectedResult
    expect(rechazado.reason).toMatchObject({ status: 409, code: "previa_vencida" })
    expect(await listarListas(T)).toHaveLength(1)
  })

  it("es atómico: si un cambio falla no queda ninguno", async () => {
    await seedProducto(T, { alegraId: "1", costo: "100" })
    const cambios: CambioPrecios[] = [crear("Lista A", "1.5"), { op: "editarLista", listaId: "00000000-0000-4000-8000-000000000000", activa: false }]
    const e = await error(previsualizar(T, cambios))
    expect(e).toMatchObject({ status: 404, code: "lista_no_existe" })
    expect(await listarListas(T)).toHaveLength(0)
  })
})

describe("confirmación extra por variación alta (solo al SUPERAR el umbral)", () => {
  async function conLista(coef: string) {
    const lista = await seedLista(T, "Lista A", coef, { esReferencia: true })
    await seedProducto(T, { alegraId: "1", costo: "100" })
    // Deja los precios calculados con el coeficiente inicial (el umbral queda en el default de 20 %).
    await getDb().execute(sql`SELECT * FROM aplicar_precios_online(${T}, NULL::text[], 'config')`)
    return lista
  }
  const editar = (listaId: string, coeficiente: string): CambioPrecios[] => [{ op: "editarLista", listaId, coeficiente }]

  it("3,3 % se aplica con la confirmación normal", async () => {
    const l = await conLista("1.5")
    const p = await previsualizar(T, editar(l, "1.55"))
    expect(p.requiereConfirmacionExtra).toBe(false)
  })

  it("30 % exige confirmación extra; sin ella no se aplica", async () => {
    const l = await conLista("1.5")
    const cambios = editar(l, "1.95")
    const p = await previsualizar(T, cambios)
    expect(p.requiereConfirmacionExtra).toBe(true)
    const e = await error(aplicarCambios(T, ANA, { cambios, baseVersion: p.baseVersion, huella: p.huella }))
    expect(e).toMatchObject({ status: 409, code: "confirmacion_extra" })
    expect((await fila("1")).precioOnlineRef).toBe("150.00") // no se aplicó
    await aplicarCambios(T, ANA, { cambios, baseVersion: p.baseVersion, huella: p.huella, confirmaExtra: true })
    expect((await fila("1")).precioOnlineRef).toBe("195.00")
  })

  it("exactamente 20 % NO exige confirmación extra", async () => {
    const l = await conLista("1.5")
    const p = await previsualizar(T, editar(l, "1.8")) // 150 -> 180 = 20 % justos
    expect(p.requiereConfirmacionExtra).toBe(false)
  })

  it("20,01 % sí exige", async () => {
    const l = await conLista("2")
    // 200 -> 240,2 (coef 2.402) = 20,1 %
    const p = await previsualizar(T, editar(l, "2.402"))
    expect(p.requiereConfirmacionExtra).toBe(true)
  })

  it("el umbral es configurable: con 10 %, un 15 % exige confirmación extra", async () => {
    const l = await conLista("2")
    const p0 = await previsualizar(T, [{ op: "setUmbrales", confirmacionPct: "10" }])
    await aplicarCambios(T, ANA, { cambios: [{ op: "setUmbrales", confirmacionPct: "10" }], baseVersion: p0.baseVersion, huella: p0.huella })
    const p = await previsualizar(T, editar(l, "2.3")) // 200 -> 230 = 15 %
    expect(p.umbralPct).toBe(10)
    expect(p.requiereConfirmacionExtra).toBe(true)
  })

  it("la primera carga no exige confirmación extra aunque el precio sea alto", async () => {
    await seedProducto(T, { alegraId: "1", costo: "100" })
    const p = await previsualizar(T, [crear("Lista A", "50")])
    expect(p.requiereConfirmacionExtra).toBe(false)
  })

  it("cambiar de lista de referencia mide la variación del precio principal", async () => {
    const a = await seedLista(T, "Lista A", "1.5", { esReferencia: true })
    const b = await seedLista(T, "Lista B", "2")
    await seedProducto(T, { alegraId: "1", costo: "100" })
    await getDb().execute(sql`SELECT * FROM aplicar_precios_online(${T}, NULL::text[], 'config')`)
    expect(a).toBeDefined()
    const p = await previsualizar(T, [{ op: "setReferencia", listaId: b }])
    expect(p.productosAfectados).toBe(1)
    expect(p.requiereConfirmacionExtra).toBe(true) // 150 -> 200 = 33 %
  })
})

describe("reglas de lista", () => {
  it("la primera lista es la referencia; setReferencia mueve la marca en una sola transacción", async () => {
    await previaYAplicar([crear("Lista A", "1.5")])
    await previaYAplicar([crear("Lista B", "1.2")])
    const [a, b] = await listarListas(T)
    expect([a.esReferencia, b.esReferencia]).toEqual([true, false])
    await previaYAplicar([{ op: "setReferencia", listaId: b.id }])
    const listas = await listarListas(T)
    expect(listas.filter((l) => l.esReferencia).map((l) => l.nombre)).toEqual(["Lista B"])
  })

  it("no se elimina la lista de referencia ni se la desactiva", async () => {
    await previaYAplicar([crear("Lista A", "1.5")])
    const [a] = await listarListas(T)
    expect(await error(previsualizar(T, [{ op: "borrarLista", listaId: a.id }]))).toMatchObject({ status: 422, code: "referencia_no_se_borra" })
    expect(await error(previsualizar(T, [{ op: "editarLista", listaId: a.id, activa: false }]))).toMatchObject({ status: 422, code: "referencia_inactiva" })
  })

  it("la referencia debe estar activa", async () => {
    await previaYAplicar([crear("Lista A", "1.5")])
    await previaYAplicar([crear("Lista B", "1.2")])
    const b = (await listarListas(T))[1]
    await previaYAplicar([{ op: "editarLista", listaId: b.id, activa: false }])
    expect(await error(previsualizar(T, [{ op: "setReferencia", listaId: b.id }]))).toMatchObject({ code: "referencia_inactiva" })
  })

  it("nombres únicos por tenant sin importar mayúsculas", async () => {
    await previaYAplicar([crear("Lista A", "1.5")])
    expect(await error(previsualizar(T, [crear("LISTA a", "1.2")]))).toMatchObject({ status: 422, code: "duplicado" })
    await expect(previsualizar(OTRO, [crear("Lista A", "1.2")])).resolves.toBeDefined() // otro tenant: libre
  })

  it("coeficiente < 1 también lo rechaza la base (CHECK)", async () => {
    await expect(seedLista(T, "Mala", "0.99")).rejects.toThrow()
    const lista = await seedLista(T, "Buena", "1")
    await expect(
      getDb().insert(listaPrecioOverrides).values({ tenantId: T, listaId: lista, tipo: "marca", marca: "x", coeficiente: "0.5" }),
    ).rejects.toThrow()
  })

  it("el override de categoría exige una categoría del tenant", async () => {
    await previaYAplicar([crear("Lista A", "1.5")])
    const [a] = await listarListas(T)
    const ajena = await seedCategoria(OTRO, "ajena")
    expect(
      await error(previsualizar(T, [{ op: "upsertOverride", listaId: a.id, tipo: "categoria", categoriaId: ajena, coeficiente: "1.3" }])),
    ).toMatchObject({ status: 404, code: "categoria_no_existe" })
  })

  it("upsertOverride crea y luego edita el mismo ajuste", async () => {
    await previaYAplicar([crear("Lista A", "1.5")])
    const [a] = await listarListas(T)
    const mk = (coef: string): CambioPrecios[] => [{ op: "upsertOverride", listaId: a.id, tipo: "marca", marca: "Marca X", coeficiente: coef }]
    await previaYAplicar(mk("1.7"))
    await previaYAplicar(mk("1.8"))
    expect((await listarListas(T))[0].overrides).toMatchObject([{ marca: "marca x", coeficiente: "1.8000" }])
    const tipos = (await listarHistorial(T, { start: 0, limit: 10 })).items.map((i) => i.tipo)
    expect(tipos).toEqual(["override_edicion", "override_alta", "lista_alta"])
  })

  it("aísla por tenant: un tenant no ve ni toca las listas del otro", async () => {
    await previaYAplicar([crear("Lista A", "1.5")])
    expect(await listarListas(OTRO)).toEqual([])
    const [a] = await listarListas(T)
    expect(await error(previsualizar(OTRO, [{ op: "editarLista", listaId: a.id, coeficiente: "3" }]))).toMatchObject({ status: 404 })
  })
})

describe("revertir (solo la última entrada vigente de cada objeto)", () => {
  async function conCambio() {
    await seedProducto(T, { alegraId: "1", costo: "100" })
    await previaYAplicar([crear("Lista A", "1.5")])
    const [a] = await listarListas(T)
    await previaYAplicar([{ op: "editarLista", listaId: a.id, coeficiente: "1.6" }])
    const hist = (await listarHistorial(T, { start: 0, limit: 10 })).items
    return { lista: a, edicion: hist[0], alta: hist[1] }
  }

  it("revierte una edición: restaura el coeficiente, recalcula y deja una entrada 'revertir'", async () => {
    const { edicion } = await conCambio()
    expect((await fila("1")).precioOnlineRef).toBe("160.00")
    const previa = await previsualizarReversion(T, edicion.id)
    expect(previa.resultado.productosAfectados).toBe(1)
    await aplicarReversion(T, ANA, edicion.id, { baseVersion: previa.resultado.baseVersion, huella: previa.resultado.huella })
    expect((await fila("1")).precioOnlineRef).toBe("150.00")
    expect((await listarListas(T))[0].coeficiente).toBe("1.5000")
    const hist = (await listarHistorial(T, { start: 0, limit: 10 })).items
    expect(hist[0]).toMatchObject({ tipo: "revertir", revertidoDe: edicion.id })
    expect(hist.find((h) => h.id === edicion.id)?.revertido).toBe(true)
  })

  it("no se revierte dos veces ni un cambio con otro posterior sobre el mismo objeto", async () => {
    const { edicion, alta } = await conCambio()
    // El alta tiene una edición posterior sobre la misma lista: choque.
    expect(await error(previsualizarReversion(T, alta.id))).toMatchObject({ status: 409, code: "choque" })
    const previa = await previsualizarReversion(T, edicion.id)
    await aplicarReversion(T, ANA, edicion.id, { baseVersion: previa.resultado.baseVersion, huella: previa.resultado.huella })
    expect(await error(previsualizarReversion(T, edicion.id))).toMatchObject({ status: 409, code: "ya_revertido" })
  })

  it("revertir una baja restaura la lista con sus ajustes", async () => {
    await previaYAplicar([crear("Lista A", "1.5")])
    await previaYAplicar([crear("Lista B", "1.2")])
    const b = (await listarListas(T))[1]
    await previaYAplicar([{ op: "upsertOverride", listaId: b.id, tipo: "marca", marca: "x", coeficiente: "1.4" }])
    await previaYAplicar([{ op: "borrarLista", listaId: b.id }])
    expect(await listarListas(T)).toHaveLength(1)
    const baja = (await listarHistorial(T, { start: 0, limit: 10 })).items[0]
    expect(baja.tipo).toBe("lista_baja")
    const previa = await previsualizarReversion(T, baja.id)
    await aplicarReversion(T, ANA, baja.id, { baseVersion: previa.resultado.baseVersion, huella: previa.resultado.huella })
    const listas = await listarListas(T)
    expect(listas.map((l) => l.nombre)).toEqual(["Lista A", "Lista B"])
    expect(listas[1].id).toBe(b.id)
    expect(listas[1].overrides).toMatchObject([{ marca: "x", coeficiente: "1.4000" }])
  })

  it("revertir un alta borra la lista; revertir un umbral lo restaura; ajustes se restauran", async () => {
    await previaYAplicar([crear("Lista A", "1.5")])
    await previaYAplicar([{ op: "setUmbrales", confirmacionPct: "35", retencionPct: "5" }])
    const um = (await listarHistorial(T, { start: 0, limit: 5 })).items[0]
    let pr = await previsualizarReversion(T, um.id)
    await aplicarReversion(T, ANA, um.id, { baseVersion: pr.resultado.baseVersion, huella: pr.resultado.huella })
    expect(await leerConfig(T)).toMatchObject({ umbralConfirmacionPct: "20.00", umbralRetencionPct: "10.00" })

    const [a] = await listarListas(T)
    await previaYAplicar([{ op: "upsertOverride", listaId: a.id, tipo: "marca", marca: "x", coeficiente: "1.7" }])
    const ov = (await listarHistorial(T, { start: 0, limit: 5 })).items[0]
    pr = await previsualizarReversion(T, ov.id)
    await aplicarReversion(T, ANA, ov.id, { baseVersion: pr.resultado.baseVersion, huella: pr.resultado.huella })
    expect((await listarListas(T))[0].overrides).toEqual([])
  })

  it("el historial no se edita ni se borra (no existe ningún camino que lo haga) y es por tenant", async () => {
    await conCambio()
    expect((await listarHistorial(OTRO, { start: 0, limit: 10 })).total).toBe(0)
    expect((await listarHistorial(T, { start: 0, limit: 10 })).total).toBe(2)
  })
})

describe("recalcular tras la sync y retenidos", () => {
  beforeEach(async () => {
    await seedLista(T, "Lista A", "2", { esReferencia: true })
  })
  const setCosto = (alegraId: string, costo: string | null) =>
    getDb().update(catalogProducts).set({ costo }).where(eq(catalogProducts.alegraId, alegraId))

  it("recalcularPreciosItems aplica un costo dentro del umbral y retiene el que lo supera", async () => {
    await seedProducto(T, { alegraId: "1", costo: "100" })
    await seedProducto(T, { alegraId: "2", costo: "100" })
    await recalcularTodos(T)
    await setCosto("1", "104")
    await setCosto("2", "150")
    const r = await recalcularPreciosItems(T, ["1", "2"])
    expect(r.retenidos).toBe(1)
    expect((await fila("1")).precioOnlineRef).toBe("208.00")
    expect((await fila("2")).precioOnlineRef).toBe("200.00")
    expect(await recalcularPreciosItems(T, [])).toEqual({ actualizados: 0, retenidos: 0 })
  })

  it("aprobar un retenido actualiza el precio y deja historial; rechazar lo descarta", async () => {
    await seedProducto(T, { alegraId: "1", costo: "100" })
    await seedProducto(T, { alegraId: "2", costo: "100" })
    await recalcularTodos(T)
    await setCosto("1", "150")
    await setCosto("2", "300")
    await recalcularPreciosItems(T, null)
    const { items, total } = await listarRetenidos(T, { start: 0, limit: 50 })
    expect(total).toBe(2)
    const r1 = items.find((i) => i.alegraId === "1")!
    const r2 = items.find((i) => i.alegraId === "2")!
    expect(r1).toMatchObject({ costoVigente: "100.0000", costoPropuesto: "150.0000", variacionPct: "50.00", sinCosto: false })

    const ap = await aprobarRetenidos(T, ANA, [r1.id])
    expect(ap).toEqual({ resueltos: 1, omitidos: [] })
    expect((await fila("1")).precioOnlineRef).toBe("300.00")
    const rz = await rechazarRetenidos(T, ANA, [r2.id])
    expect(rz.resueltos).toBe(1)
    expect((await fila("2")).precioOnlineRef).toBe("200.00")
    expect((await listarRetenidos(T, { start: 0, limit: 50 })).total).toBe(0)

    const hist = (await listarHistorial(T, { start: 0, limit: 10 })).items
    expect(hist.map((h) => h.tipo).sort()).toEqual(["costo_aprobado", "costo_rechazado"])
    const aprob = hist.find((h) => h.tipo === "costo_aprobado")!
    expect(aprob).toMatchObject({ usuario: "ana.admin@example.com" })
    expect(aprob.antes).toMatchObject({ costo: "100.0000", precio: "200.00" })
    expect(aprob.despues).toMatchObject({ costo: "150.0000", precio: "300.00" })

    // Rechazada con el mismo costo: la sync siguiente no reabre; con otro costo sí.
    await recalcularPreciosItems(T, ["2"])
    expect((await listarRetenidos(T, { start: 0, limit: 50 })).total).toBe(0)
    await setCosto("2", "310")
    await recalcularPreciosItems(T, ["2"])
    expect((await listarRetenidos(T, { start: 0, limit: 50 })).total).toBe(1)
  })

  it("un retenido sin costo propuesto no se aprueba (nunca deja un producto sin precio)", async () => {
    await seedProducto(T, { alegraId: "1", costo: "100" })
    await recalcularTodos(T)
    await setCosto("1", null)
    await recalcularPreciosItems(T, ["1"])
    const [r] = (await listarRetenidos(T, { start: 0, limit: 5 })).items
    expect(r.sinCosto).toBe(true)
    const ap = await aprobarRetenidos(T, ANA, [r.id])
    expect(ap).toEqual({ resueltos: 0, omitidos: [r.id] })
    expect((await fila("1")).precioOnlineRef).toBe("200.00")
  })

  it("aprobar es por tenant: no resuelve retenidos de otro", async () => {
    await seedProducto(T, { alegraId: "1", costo: "100" })
    await recalcularTodos(T)
    await setCosto("1", "300")
    await recalcularPreciosItems(T, null)
    const [r] = (await listarRetenidos(T, { start: 0, limit: 5 })).items
    expect(await aprobarRetenidos(OTRO, ANA, [r.id])).toEqual({ resueltos: 0, omitidos: [r.id] })
    expect((await getDb().select().from(preciosOnlineRetenciones))[0].estado).toBe("pendiente")
  })

  it("alertas: sin costo, sin precio, nuevos sin revisar y retenidos", async () => {
    await seedProducto(T, { alegraId: "1", costo: "100" }) // sin overlay => nuevo
    await seedProducto(T, { alegraId: "2", costo: null })
    const cat = await seedCategoria(T, "c")
    await seedProducto(T, { alegraId: "3", costo: "50", categoriaId: cat }) // con overlay
    await seedProducto(T, { alegraId: "4", costo: "10", status: "inactive" }) // fuera de la cuenta
    await recalcularTodos(T)
    await setCosto("3", "500")
    await recalcularPreciosItems(T, ["3"])
    expect(await contarAlertas(T)).toEqual({ sinCosto: 1, sinPrecio: 0, nuevosSinRevisar: 2, retenidos: 1 })
    expect(await contarAlertas(OTRO)).toEqual({ sinCosto: 0, sinPrecio: 0, nuevosSinRevisar: 0, retenidos: 0 })
  })

  it("sin listas todo producto con costo queda 'sin precio online'", async () => {
    await getDb().delete(listasPrecioOnline)
    await seedProducto(T, { alegraId: "1", costo: "100" })
    await recalcularTodos(T)
    expect((await contarAlertas(T)).sinPrecio).toBe(1)
  })
})

describe("concurrencia: sync (recálculo por ítems) vs cambio masivo", () => {
  it("el estado final es consistente con el cálculo, sin importar el entrelazado", async () => {
    const lista = await seedLista(T, "Lista A", "1.5", { esReferencia: true })
    await seedOverrideMarca(T, lista, "marca x", "1.6")
    const N = 40
    for (let i = 0; i < N; i++) await seedProducto(T, { alegraId: `p${i}`, costo: `${100 + i}`, brand: i % 2 ? "Marca X" : "Y" })
    await recalcularTodos(T)
    const ids = Array.from({ length: N }, (_, i) => `p${i}`)
    const cambios: CambioPrecios[] = [{ op: "editarLista", listaId: lista, coeficiente: "1.7" }]
    const p = await previsualizar(T, cambios)
    // La "sync" sube costos (dentro del umbral) en lotes mientras se aplica el cambio masivo.
    const sync = (async () => {
      for (let lote = 0; lote < 4; lote++) {
        const sub = ids.slice(lote * 10, lote * 10 + 10)
        for (const id of sub) await getDb().update(catalogProducts).set({ costo: "105" }).where(eq(catalogProducts.alegraId, id))
        await recalcularPreciosItems(T, sub)
      }
    })()
    // El aplicar puede ser 409 si la sync ganó la carrera (huella desfasada): es el comportamiento correcto.
    const aplicar = aplicarCambios(T, ANA, { cambios, baseVersion: p.baseVersion, huella: p.huella, confirmaExtra: true }).catch((e) => e)
    const [, r] = await Promise.all([sync, aplicar])
    if (r instanceof Error) expect(r).toMatchObject({ status: 409 })
    else await recalcularTodos(T)
    // Convergencia: lo materializado == lo que calcula la función con el estado final.
    await recalcularTodos(T)
    const calc = new Map((await calcular(T)).map((f) => [f.alegra_id, f.precio]))
    const filas = await getDb().select().from(catalogProducts)
    for (const f of filas) expect(f.precioOnlineRef, f.alegraId).toBe(calc.get(f.alegraId))
  })
})
