import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { and, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { listaPrecioOverrides, preciosOnlineCambios } from "@/db/schema"
import { validarCambios, type CambioPrecios } from "@/lib/precios-online-cambios"
import {
  PreciosOnlineError,
  aplicarCambios,
  aplicarReversion,
  listarHistorial,
  previsualizar,
  previsualizarReversion,
  type UsuarioActor,
} from "@/lib/precios-online-repo"
import { seedTenant, truncateAll } from "./helpers"
import { calcular, seedLista, seedOverrideMarca, seedOverrideProducto, seedProducto } from "./precios-online-helpers"

// R5: asignación masiva de porcentajes por producto (op `ajusteProductos`). Postgres real (crm_test).
// Datos inventados.

const T = "tenant-lote"
const OTRO = "tenant-lote-otro"
const ANA: UsuarioActor = { id: "u1", name: "Ana Admin", email: "ana.admin@example.com" }

let tarjeta: string
let transferencia: string
const ids = Array.from({ length: 12 }, (_, i) => `p${i + 1}`)

beforeEach(async () => {
  await truncateAll()
  await seedTenant(T)
  await seedTenant(OTRO)
  tarjeta = await seedLista(T, "Tarjeta", "1.6", { esReferencia: true })
  transferencia = await seedLista(T, "Transferencia", "1.3")
  for (const id of ids) await seedProducto(T, { alegraId: id, costo: "100", brand: "acme" })
})
afterAll(async () => {
  await truncateAll()
})

async function aplicarLote(cambios: CambioPrecios[], tenant = T) {
  const p = await previsualizar(tenant, cambios)
  return aplicarCambios(tenant, ANA, { cambios, baseVersion: p.baseVersion, huella: p.huella, confirmaExtra: true })
}
const lote = (alegraIds: string[], ajustes: { listaId: string; coeficiente: string | null }[]): CambioPrecios => ({
  op: "ajusteProductos",
  alegraIds,
  ajustes,
})
const precio = async (alegraId: string, listaId: string, tenant = T) =>
  (await calcular(tenant, [alegraId])).find((f) => f.lista_id === listaId)?.precio
const overrides = (tenant = T) =>
  getDb().select().from(listaPrecioOverrides).where(and(eq(listaPrecioOverrides.tenantId, tenant), eq(listaPrecioOverrides.tipo, "producto")))
const error = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e as PreciosOnlineError
  }
  throw new Error("no falló")
}

describe("selección y asignación", () => {
  it("12 productos x 2 listas = 24 overrides y UNA sola fila de historial; el precio usa el coeficiente", async () => {
    const r = await aplicarLote([lote(ids, [{ listaId: tarjeta, coeficiente: "1.85" }, { listaId: transferencia, coeficiente: "1.5" }])])
    expect(r.entradas).toBe(1)
    expect(await overrides()).toHaveLength(24)
    expect(await precio("p3", tarjeta)).toBe("185.00")
    expect(await precio("p3", transferencia)).toBe("150.00")
    const h = await getDb().select().from(preciosOnlineCambios).where(eq(preciosOnlineCambios.tenantId, T))
    expect(h).toHaveLength(1)
    expect(h[0].tipo).toBe("ajuste_lote")
    expect(h[0].objeto).toMatch(/^lote:/)
  })

  it("selección mixta: una lista con coeficiente y otra sin tocar", async () => {
    await aplicarLote([lote(ids.slice(0, 3), [{ listaId: tarjeta, coeficiente: "1.85" }])])
    expect(await precio("p1", tarjeta)).toBe("185.00")
    expect(await precio("p1", transferencia)).toBe("130.00")
    expect(await precio("p9", tarjeta)).toBe("160.00")
  })

  it("quitar: coeficiente null borra los overrides de producto y vuelve a regir la marca", async () => {
    await seedOverrideMarca(T, tarjeta, "acme", "1.7")
    await aplicarLote([lote(ids, [{ listaId: tarjeta, coeficiente: "1.9" }])])
    expect(await precio("p1", tarjeta)).toBe("190.00")
    await aplicarLote([lote(ids, [{ listaId: tarjeta, coeficiente: null }])])
    expect(await overrides()).toHaveLength(0)
    expect(await precio("p1", tarjeta)).toBe("170.00")
  })

  it("precedencia: el producto gana sobre la marca", async () => {
    await seedOverrideMarca(T, tarjeta, "acme", "1.75")
    await aplicarLote([lote(["p1"], [{ listaId: tarjeta, coeficiente: "1.9" }])])
    expect(await precio("p1", tarjeta)).toBe("190.00")
    expect(await precio("p2", tarjeta)).toBe("175.00")
  })

  it("actualiza los overrides existentes en vez de duplicarlos", async () => {
    await seedOverrideProducto(T, tarjeta, "p1", "1.7")
    await aplicarLote([lote(["p1", "p2"], [{ listaId: tarjeta, coeficiente: "1.8" }])])
    const o = await overrides()
    expect(o).toHaveLength(2)
    expect(o.every((x) => Number(x.coeficiente) === 1.8)).toBe(true)
  })

  it("coeficiente inválido: el validador lo rechaza antes de llegar a la base", () => {
    expect(validarCambios([lote(ids, [{ listaId: tarjeta, coeficiente: "0.9" }])])).toMatchObject({ ok: false })
  })

  it("seleccionar todos los N: 1.500 productos en un solo cambio", async () => {
    const muchos = Array.from({ length: 1500 }, (_, i) => `m${i}`)
    for (let i = 0; i < muchos.length; i += 250) {
      await Promise.all(muchos.slice(i, i + 250).map((id) => seedProducto(T, { alegraId: id, costo: "10" })))
    }
    const r = await aplicarLote([lote(muchos, [{ listaId: tarjeta, coeficiente: "2" }])])
    expect(r.entradas).toBe(1)
    expect(await overrides()).toHaveLength(1500)
  }, 60_000)

  it("sin cambios reales: 422 sin_cambios", async () => {
    await aplicarLote([lote(ids, [{ listaId: tarjeta, coeficiente: "1.85" }])])
    const e = await error(previsualizar(T, [lote(ids, [{ listaId: tarjeta, coeficiente: "1.85" }])]))
    expect(e).toMatchObject({ status: 422, code: "sin_cambios" })
  })
})

describe("aislamiento por tenant", () => {
  it("un producto de otro tenant o inexistente se rechaza y no se escribe nada", async () => {
    await seedProducto(OTRO, { alegraId: "ajeno", costo: "100" })
    const e = await error(previsualizar(T, [lote(["p1", "ajeno"], [{ listaId: tarjeta, coeficiente: "1.85" }])]))
    expect(e).toMatchObject({ status: 404, code: "producto_no_existe" })
    expect(await overrides()).toHaveLength(0)
  })

  it("una lista de otro tenant se rechaza", async () => {
    const ajena = await seedLista(OTRO, "Ajena", "1.2", { esReferencia: true })
    const e = await error(previsualizar(T, [lote(["p1"], [{ listaId: ajena, coeficiente: "1.85" }])]))
    expect(e).toMatchObject({ status: 404, code: "lista_no_existe" })
  })

  it("no toca los overrides de otro tenant", async () => {
    const lo = await seedLista(OTRO, "Tarjeta", "1.6", { esReferencia: true })
    await seedProducto(OTRO, { alegraId: "p1", costo: "100" })
    await seedOverrideProducto(OTRO, lo, "p1", "1.4")
    await aplicarLote([lote(ids, [{ listaId: tarjeta, coeficiente: "1.85" }])])
    await aplicarLote([lote(ids, [{ listaId: tarjeta, coeficiente: null }])])
    expect(await overrides(OTRO)).toHaveLength(1)
    expect(Number((await overrides(OTRO))[0].coeficiente)).toBe(1.4)
  })
})

describe("historial y revertir", () => {
  const entradaLote = async () => {
    const h = await listarHistorial(T, { start: 0, limit: 50 })
    return h.items.find((x) => x.tipo === "ajuste_lote")!
  }

  it("revierte el lote: restaura los overrides anteriores y lo registra", async () => {
    await seedOverrideProducto(T, tarjeta, "p1", "1.7")
    await aplicarLote([lote(["p1", "p2"], [{ listaId: tarjeta, coeficiente: "1.85" }])])
    expect(await precio("p1", tarjeta)).toBe("185.00")
    const e = await entradaLote()
    const pr = await previsualizarReversion(T, e.id)
    expect(pr.cambios[0].op).toBe("restaurarAjustes")
    await aplicarReversion(T, ANA, e.id, { baseVersion: pr.resultado.baseVersion, huella: pr.resultado.huella, confirmaExtra: true })
    expect(await precio("p1", tarjeta)).toBe("170.00")
    expect(await precio("p2", tarjeta)).toBe("160.00")
    expect(await overrides()).toHaveLength(1)
    const rev = (await listarHistorial(T, { start: 0, limit: 50 })).items.filter((x) => x.tipo === "revertir")
    expect(rev).toHaveLength(1)
    const otra = await error(previsualizarReversion(T, e.id))
    expect(otra).toMatchObject({ status: 409, code: "ya_revertido" })
  })

  it("choque: si un override del lote cambió después, 409 con detalle", async () => {
    await aplicarLote([lote(["p1", "p2"], [{ listaId: tarjeta, coeficiente: "1.85" }])])
    const e = await entradaLote()
    await getDb()
      .update(listaPrecioOverrides)
      .set({ coeficiente: "1.95" })
      .where(and(eq(listaPrecioOverrides.listaId, tarjeta), eq(listaPrecioOverrides.alegraId, "p1")))
    const err = await error(previsualizarReversion(T, e.id))
    expect(err).toMatchObject({ status: 409, code: "choque" })
    expect((err.extra as { total: number }).total).toBe(1)
  })

  it("choque: un override borrado después también impide revertir", async () => {
    await aplicarLote([lote(["p1"], [{ listaId: tarjeta, coeficiente: "1.85" }])])
    const e = await entradaLote()
    await getDb().delete(listaPrecioOverrides).where(eq(listaPrecioOverrides.alegraId, "p1"))
    expect(await error(previsualizarReversion(T, e.id))).toMatchObject({ status: 409, code: "choque" })
  })
})
