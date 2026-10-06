import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { crearMedioPago, listarMediosPago } from "@/lib/medios-pago-shop-repo"
import { aplicarCambios, aplicarReversion, listarHistorial, previsualizar, previsualizarReversion } from "@/lib/precios-online-repo"
import type { CambioPrecios } from "@/lib/precios-online-cambios"
import { seedLista, seedProducto } from "./precios-online-helpers"
import { seedTenant, truncateAll } from "./helpers"

/**
 * Migración 0066 (change payway-cobro, rebanada 0): `lista_precio_condiciones.monto_minimo`.
 * CHECK en la base, edición por el camino real (vista previa + aplicar), historial y undo. Datos
 * inventados.
 */

const A = "tenant-a"
const USUARIO = { id: "u1", name: "Ana", email: "ana@cliente.example" }

let listaRef: string
let listaB: string

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
  listaRef = await seedLista(A, "Lista A", "1.2", { esReferencia: true, orden: 1 })
  listaB = await seedLista(A, "Lista B", "1.3", { orden: 2 })
  await seedProducto(A, { alegraId: "p1", costo: "100" })
  await crearMedioPago(A, { slug: "tarjeta", nombre: "Tarjeta" })
})
afterAll(async () => {
  await truncateAll()
})

async function cambiar(cambios: CambioPrecios[]) {
  const previa = await previsualizar(A, cambios)
  await aplicarCambios(A, USUARIO, { cambios, baseVersion: previa.baseVersion, huella: previa.huella })
}

async function error(p: Promise<unknown>) {
  try {
    await p
  } catch (e) {
    return e as { status?: number; code?: string }
  }
  return null
}

describe("CHECK de la migración 0066", () => {
  it("rechaza un mínimo en la fila de pago único (cuotas NULL)", async () => {
    await expect(
      getDb().execute(sql`
        insert into lista_precio_condiciones (tenant_id, lista_id, medio_slug, cuotas, monto_minimo)
        values (${A}, ${listaRef}, 'tarjeta', null, 1000)
      `),
    ).rejects.toMatchObject({ cause: { code: "23514" } })
  })

  it("rechaza un mínimo negativo", async () => {
    await expect(
      getDb().execute(sql`
        insert into lista_precio_condiciones (tenant_id, lista_id, medio_slug, cuotas, monto_minimo)
        values (${A}, ${listaRef}, 'tarjeta', 6, -1)
      `),
    ).rejects.toMatchObject({ cause: { code: "23514" } })
  })

  it("acepta NULL, 0 y un monto positivo en filas de cuotas", async () => {
    await getDb().execute(sql`
      insert into lista_precio_condiciones (tenant_id, lista_id, medio_slug, cuotas, monto_minimo)
      values (${A}, ${listaRef}, 'tarjeta', 3, null), (${A}, ${listaRef}, 'tarjeta', 6, 0), (${A}, ${listaRef}, 'tarjeta', 12, 80000.5)
    `)
  })
})

describe("setCondicion con montoMinimo", () => {
  it("el mínimo llega al DTO del medio", async () => {
    await cambiar([
      { op: "setCondicion", medioSlug: "tarjeta", cuotas: 3, listaId: listaRef },
      { op: "setCondicion", medioSlug: "tarjeta", cuotas: 6, listaId: listaB, montoMinimo: "50000.00" },
    ])
    const [mp] = (await listarMediosPago(A)).filter((m) => m.slug === "tarjeta")
    expect(mp.condicionesCuotas.map((c) => [c.cuotas, c.montoMinimo])).toEqual([
      [3, null],
      [6, "50000.00"],
    ])
  })

  it("cambiar solo el monto con la misma lista NO es sin_cambios: se versiona y entra al historial", async () => {
    await cambiar([{ op: "setCondicion", medioSlug: "tarjeta", cuotas: 6, listaId: listaRef, montoMinimo: "50000.00" }])
    await cambiar([{ op: "setCondicion", medioSlug: "tarjeta", cuotas: 6, listaId: listaRef, montoMinimo: "80000.00" }])
    const [mp] = await listarMediosPago(A)
    expect(mp.condicionesCuotas[0].montoMinimo).toBe("80000.00")
    const hist = (await listarHistorial(A, { start: 0, limit: 10 })).items
    expect(hist[0]).toMatchObject({ tipo: "condicion" })
  })

  it("repetir exactamente lista y monto sigue siendo sin_cambios", async () => {
    await cambiar([{ op: "setCondicion", medioSlug: "tarjeta", cuotas: 6, listaId: listaRef, montoMinimo: "50000.00" }])
    const cambios: CambioPrecios[] = [
      { op: "setCondicion", medioSlug: "tarjeta", cuotas: 6, listaId: listaRef, montoMinimo: "50000.00" },
    ]
    expect(await error(previsualizar(A, cambios))).toMatchObject({ status: 422, code: "sin_cambios" })
  })

  it("un cambio sin montoMinimo (undefined) sobre una fila con mínimo lo deja en NULL (sin mínimo)", async () => {
    await cambiar([{ op: "setCondicion", medioSlug: "tarjeta", cuotas: 6, listaId: listaRef, montoMinimo: "50000.00" }])
    await cambiar([{ op: "setCondicion", medioSlug: "tarjeta", cuotas: 6, listaId: listaRef }])
    const [mp] = await listarMediosPago(A)
    expect(mp.condicionesCuotas[0].montoMinimo).toBeNull()
  })

  it("un mínimo en el pago único se rechaza (422)", async () => {
    const e = await error(
      previsualizar(A, [{ op: "setCondicion", medioSlug: "tarjeta", cuotas: null, listaId: listaRef, montoMinimo: "1000.00" }]),
    )
    expect(e).toMatchObject({ status: 422 })
  })

  it("deshacer restaura el monto anterior junto con medio, cuotas y lista", async () => {
    await cambiar([{ op: "setCondicion", medioSlug: "tarjeta", cuotas: 6, listaId: listaRef, montoMinimo: "50000.00" }])
    await cambiar([{ op: "setCondicion", medioSlug: "tarjeta", cuotas: 6, listaId: listaRef, montoMinimo: "80000.00" }])
    const hist = (await listarHistorial(A, { start: 0, limit: 10 })).items
    const previa = await previsualizarReversion(A, hist[0].id)
    await aplicarReversion(A, USUARIO, hist[0].id, { baseVersion: previa.resultado.baseVersion, huella: previa.resultado.huella })
    const [mp] = await listarMediosPago(A)
    expect(mp.condicionesCuotas[0]).toMatchObject({ cuotas: 6, listaId: listaRef, montoMinimo: "50000.00" })
  })

  it("deshacer el alta de una condición con mínimo la quita", async () => {
    await cambiar([{ op: "setCondicion", medioSlug: "tarjeta", cuotas: 6, listaId: listaRef, montoMinimo: "50000.00" }])
    const hist = (await listarHistorial(A, { start: 0, limit: 10 })).items
    const previa = await previsualizarReversion(A, hist[0].id)
    await aplicarReversion(A, USUARIO, hist[0].id, { baseVersion: previa.resultado.baseVersion, huella: previa.resultado.huella })
    const [mp] = await listarMediosPago(A)
    expect(mp.condicionesCuotas).toEqual([])
  })

  it("deshacer la baja de una condición con mínimo la restaura con su mínimo", async () => {
    await cambiar([{ op: "setCondicion", medioSlug: "tarjeta", cuotas: 6, listaId: listaRef, montoMinimo: "50000.00" }])
    await cambiar([{ op: "setCondicion", medioSlug: "tarjeta", cuotas: 6, listaId: null }])
    const hist = (await listarHistorial(A, { start: 0, limit: 10 })).items
    const previa = await previsualizarReversion(A, hist[0].id)
    await aplicarReversion(A, USUARIO, hist[0].id, { baseVersion: previa.resultado.baseVersion, huella: previa.resultado.huella })
    const [mp] = await listarMediosPago(A)
    expect(mp.condicionesCuotas[0]).toMatchObject({ cuotas: 6, montoMinimo: "50000.00" })
  })
})
