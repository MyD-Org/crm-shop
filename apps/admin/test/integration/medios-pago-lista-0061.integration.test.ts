import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import {
  actualizarMedioPago,
  crearMedioPago,
  listarMediosPago,
  listarMediosPagoConAvisos,
  listasDisponiblesParaMedios,
} from "@/lib/medios-pago-shop-repo"
import { aplicarCambios, previsualizar } from "@/lib/precios-online-repo"
import { seedLista, seedProducto } from "./precios-online-helpers"
import { seedTenant, truncateAll } from "./helpers"

/**
 * Migración 0061 (destacado y ficha por medio) y su evolución en 0065: la lista que rige para un
 * medio ya no es una lista de Alegra sino una lista de precio online (condición de pago único).
 * Columnas, índice único del destacado, N medios en ficha, destacar atómico y avisos. Datos
 * inventados.
 */

const A = "tenant-a"
const B = "tenant-b"
const USUARIO = { id: "u1", name: "Ana", email: "ana@cliente.example" }

let listaRef: string
let listaTransf: string

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
  await seedTenant(B)
  listaRef = await seedLista(A, "Lista A", "1.2", { esReferencia: true, orden: 1 })
  listaTransf = await seedLista(A, "Lista transferencia", "1.1", { orden: 2 })
  await seedProducto(A, { alegraId: "p1", costo: "100" })
})
afterAll(async () => {
  await truncateAll()
})

/** Enlaza la lista al medio por el camino real: vista previa + aplicar. */
async function enlazar(slug: string, listaId: string | null) {
  const cambios = [{ op: "setCondicion" as const, medioSlug: slug, cuotas: null, listaId }]
  const previa = await previsualizar(A, cambios)
  await aplicarCambios(A, USUARIO, { cambios, baseVersion: previa.baseVersion, huella: previa.huella })
}

describe("migración 0061: columnas e índice", () => {
  it("los medios nuevos quedan con lista NULL, destacar=false y mostrar_en_ficha=false", async () => {
    const r = await crearMedioPago(A, { slug: "transferencia", nombre: "Transferencia" })
    expect(r).toMatchObject({
      kind: "ok",
      medio: { listaOnlineId: null, listaOnlineNombre: null, destacarEnCatalogo: false, mostrarEnFicha: false },
    })
    const cols = (await getDb().execute(sql`
      select column_name, is_nullable, column_default from information_schema.columns
      where table_name = 'medios_pago_shop' and column_name in ('id_lista_precios','lista_precios_nombre','destacar_en_catalogo','mostrar_en_ficha')
      order by column_name
    `)) as unknown as { column_name: string; is_nullable: string; column_default: string | null }[]
    expect(cols.map((c) => [c.column_name, c.is_nullable])).toEqual([
      ["destacar_en_catalogo", "NO"],
      ["mostrar_en_ficha", "NO"],
    ])
  })

  it("un segundo destacado en el mismo tenant viola el índice único; en otro tenant no", async () => {
    const db = getDb()
    await db.execute(sql`insert into medios_pago_shop (tenant_id, slug, nombre, destacar_en_catalogo) values (${A}, 'uno', 'Uno', true)`)
    await expect(
      db.execute(sql`insert into medios_pago_shop (tenant_id, slug, nombre, destacar_en_catalogo) values (${A}, 'dos', 'Dos', true)`),
    ).rejects.toMatchObject({ cause: { code: "23505" } })
    await db.execute(sql`insert into medios_pago_shop (tenant_id, slug, nombre, destacar_en_catalogo) values (${B}, 'uno', 'Uno', true)`)
    // Varios sin destacar conviven.
    await db.execute(sql`insert into medios_pago_shop (tenant_id, slug, nombre) values (${A}, 'tres', 'Tres'), (${A}, 'cuatro', 'Cuatro')`)
  })

  it("varios medios con mostrar_en_ficha=true conviven sin error de unicidad", async () => {
    for (const s of ["uno", "dos", "tres"]) await crearMedioPago(A, { slug: s, nombre: s })
    for (const s of ["uno", "dos", "tres"]) {
      expect(await actualizarMedioPago(A, s, { mostrarEnFicha: true })).toMatchObject({ kind: "ok", medio: { mostrarEnFicha: true } })
    }
    expect((await listarMediosPago(A)).filter((m) => m.mostrarEnFicha)).toHaveLength(3)
  })
})

describe("enlazar y desenlazar la lista online", () => {
  it("enlazar muestra la lista en el medio; desenlazar la quita", async () => {
    await crearMedioPago(A, { slug: "transferencia", nombre: "Transferencia" })
    await enlazar("transferencia", listaTransf)
    expect((await listarMediosPago(A))[0]).toMatchObject({
      listaOnlineId: listaTransf,
      listaOnlineNombre: "Lista transferencia",
      listaOnlineActiva: true,
    })
    await enlazar("transferencia", null)
    expect((await listarMediosPago(A))[0]).toMatchObject({ listaOnlineId: null, listaOnlineNombre: null })
  })

  it("las listas disponibles son las activas de ESTE tenant", async () => {
    await seedLista(B, "Lista de B", "1.5", { esReferencia: true })
    await seedLista(A, "Lista apagada", "1.3", { activa: false })
    expect((await listasDisponiblesParaMedios(A)).map((l) => l.nombre)).toEqual(["Lista A", "Lista transferencia"])
  })

  it("el PATCH del medio ya no cambia la lista (el campo se ignora)", async () => {
    await crearMedioPago(A, { slug: "transferencia", nombre: "Transferencia" })
    const r = await actualizarMedioPago(A, "transferencia", { idListaPrecios: "3", activo: false } as never)
    expect(r).toMatchObject({ kind: "ok", medio: { activo: false, listaOnlineId: null } })
  })

  it("un medio con la lista desactivada conserva el enlace y lo informa", async () => {
    await crearMedioPago(A, { slug: "transferencia", nombre: "Transferencia" })
    await enlazar("transferencia", listaTransf)
    await getDb().execute(sql`update listas_precio_online set activa = false where id = ${listaTransf}`)
    expect((await listarMediosPago(A))[0]).toMatchObject({ listaOnlineId: listaTransf, listaOnlineActiva: false })
  })
})

describe("destacar en catálogo", () => {
  it("destacar B desmarca A en la misma operación", async () => {
    await crearMedioPago(A, { slug: "aa", nombre: "A" })
    await crearMedioPago(A, { slug: "bb", nombre: "B" })
    await actualizarMedioPago(A, "aa", { destacarEnCatalogo: true })
    expect(await actualizarMedioPago(A, "bb", { destacarEnCatalogo: true })).toMatchObject({ kind: "ok", medio: { slug: "bb", destacarEnCatalogo: true } })
    expect((await listarMediosPago(A)).filter((m) => m.destacarEnCatalogo).map((m) => m.slug)).toEqual(["bb"])
  })

  it("destacar en un tenant no toca al destacado de otro", async () => {
    await crearMedioPago(A, { slug: "aa", nombre: "A" })
    await crearMedioPago(B, { slug: "aa", nombre: "A" })
    await actualizarMedioPago(B, "aa", { destacarEnCatalogo: true })
    await actualizarMedioPago(A, "aa", { destacarEnCatalogo: true })
    expect((await listarMediosPago(B))[0].destacarEnCatalogo).toBe(true)
  })

  it("dos PATCH simultáneos con medios distintos: queda uno solo y ninguno responde 500", async () => {
    await crearMedioPago(A, { slug: "aa", nombre: "A" })
    await crearMedioPago(A, { slug: "bb", nombre: "B" })
    const [ra, rb] = await Promise.all([
      actualizarMedioPago(A, "aa", { destacarEnCatalogo: true }),
      actualizarMedioPago(A, "bb", { destacarEnCatalogo: true }),
    ])
    for (const r of [ra, rb]) expect(["ok", "conflict"]).toContain(r.kind)
    expect((await listarMediosPago(A)).filter((m) => m.destacarEnCatalogo)).toHaveLength(1)
  })
})

describe("avisos", () => {
  it("lista desactivada, lista más cara que la referencia y destacado sin lista", async () => {
    const listaCara = await seedLista(A, "Lista cara", "1.9", { orden: 3 })
    await crearMedioPago(A, { slug: "apagado", nombre: "Apagado" })
    await crearMedioPago(A, { slug: "caro", nombre: "Caro" })
    await crearMedioPago(A, { slug: "barato", nombre: "Barato" })
    await crearMedioPago(A, { slug: "sinlista", nombre: "Sin lista" })
    await enlazar("apagado", listaTransf)
    await enlazar("caro", listaCara)
    await enlazar("barato", listaRef)
    await actualizarMedioPago(A, "sinlista", { destacarEnCatalogo: true, mostrarEnFicha: true })
    // Con los precios online calculados (referencia 120, transferencia 110, cara 190).
    await getDb().execute(sql`select * from aplicar_precios_online(${A}, NULL::text[], 'config')`)
    await getDb().execute(sql`update listas_precio_online set activa = false where id = ${listaTransf}`)
    const { medios, listas } = await listarMediosPagoConAvisos(A)
    expect(listas.map((l) => l.nombre)).toEqual(["Lista A", "Lista cara"])
    const aviso = (slug: string) => medios.find((m) => m.slug === slug)!.avisos
    expect(aviso("apagado")[0]).toContain("desactivada")
    expect(aviso("caro")[0]).toContain("más cara")
    expect(aviso("barato")).toEqual([])
    expect(aviso("sinlista")).toHaveLength(2)
  })
})
