import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogProducts } from "@/db/schema"
import {
  actualizarMedioPago,
  crearMedioPago,
  listarMediosPago,
  listarMediosPagoConAvisos,
  listasDisponiblesParaMedios,
} from "@/lib/medios-pago-shop-repo"
import { seedTenant, truncateAll } from "./helpers"

/**
 * Migración 0061 (change `listas-por-medio-de-pago`, rebanada A) contra la base real de test:
 * columnas nuevas con sus defaults, índice único parcial del destacado (uno por tenant), N medios
 * en ficha, y el repo (enlazar/desenlazar con snapshot, destacar atómico, concurrencia).
 * Datos inventados.
 */

const A = "tenant-a"
const B = "tenant-b"

const PRECIOS = (extra: { id: string; name: string; price: number }[]) => [
  { idPriceList: "1", name: "General", price: 100, main: true },
  ...extra.map((e) => ({ idPriceList: e.id, name: e.name, price: e.price, main: false })),
]

async function seedProducto(tenantId: string, alegraId: string, prices: unknown) {
  await getDb()
    .insert(catalogProducts)
    .values({ tenantId, alegraId, name: `COD-${alegraId}`, description: "x", prices: prices as never, status: "active" })
}

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
  await seedTenant(B)
  await seedProducto(A, "p1", PRECIOS([{ id: "3", name: "Lista transferencia", price: 90 }, { id: "4", name: "Lista cara", price: 120 }]))
  await seedProducto(A, "p2", PRECIOS([{ id: "3", name: "Lista transferencia", price: 80 }, { id: "4", name: "Lista cara", price: 130 }]))
})
afterAll(async () => {
  await truncateAll()
})

describe("migración 0061: columnas e índice", () => {
  it("los medios nuevos quedan con lista NULL, destacar=false y mostrar_en_ficha=false", async () => {
    const r = await crearMedioPago(A, { slug: "transferencia", nombre: "Transferencia" })
    expect(r).toMatchObject({
      kind: "ok",
      medio: { idListaPrecios: null, listaPreciosNombre: null, destacarEnCatalogo: false, mostrarEnFicha: false },
    })
    const cols = (await getDb().execute(sql`
      select column_name, is_nullable, column_default from information_schema.columns
      where table_name = 'medios_pago_shop' and column_name in ('id_lista_precios','lista_precios_nombre','destacar_en_catalogo','mostrar_en_ficha')
      order by column_name
    `)) as unknown as { column_name: string; is_nullable: string; column_default: string | null }[]
    expect(cols.map((c) => [c.column_name, c.is_nullable])).toEqual([
      ["destacar_en_catalogo", "NO"],
      ["id_lista_precios", "YES"],
      ["lista_precios_nombre", "YES"],
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

describe("enlazar y desenlazar la lista", () => {
  it("enlazar guarda el id y el snapshot del nombre; desenlazar limpia ambos", async () => {
    await crearMedioPago(A, { slug: "transferencia", nombre: "Transferencia" })
    const e = await actualizarMedioPago(A, "transferencia", { idListaPrecios: "3" })
    expect(e).toMatchObject({ kind: "ok", medio: { idListaPrecios: "3", listaPreciosNombre: "Lista transferencia" } })
    const d = await actualizarMedioPago(A, "transferencia", { idListaPrecios: null })
    expect(d).toMatchObject({ kind: "ok", medio: { idListaPrecios: null, listaPreciosNombre: null } })
  })

  it("un id que no está en la principal → invalid (400) y no modifica el medio", async () => {
    await crearMedioPago(A, { slug: "transferencia", nombre: "Transferencia" })
    const r = await actualizarMedioPago(A, "transferencia", { idListaPrecios: "99", nombre: "Otro nombre" })
    expect(r).toMatchObject({ kind: "invalid", campo: "idListaPrecios" })
    expect((await listarMediosPago(A))[0]).toMatchObject({ nombre: "Transferencia", idListaPrecios: null })
  })

  it("las listas son las de ESTE tenant: la de otro no se puede enlazar", async () => {
    await seedProducto(B, "b1", PRECIOS([{ id: "7", name: "Lista de B", price: 50 }]))
    await crearMedioPago(A, { slug: "transferencia", nombre: "Transferencia" })
    expect(await actualizarMedioPago(A, "transferencia", { idListaPrecios: "7" })).toMatchObject({ kind: "invalid" })
    expect((await listasDisponiblesParaMedios(A)).map((l) => l.idPriceList)).toEqual(["1", "3", "4"])
  })

  it("una lista ya enlazada que se dio de baja no bloquea otros cambios si el id no cambia", async () => {
    await crearMedioPago(A, { slug: "transferencia", nombre: "Transferencia" })
    await actualizarMedioPago(A, "transferencia", { idListaPrecios: "3" })
    await getDb().execute(sql`truncate table catalog_products`)
    const r = await actualizarMedioPago(A, "transferencia", { idListaPrecios: "3", activo: false })
    expect(r).toMatchObject({ kind: "ok", medio: { idListaPrecios: "3", listaPreciosNombre: "Lista transferencia", activo: false } })
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
  it("lista huérfana (con el nombre guardado), lista más cara y destacado sin lista", async () => {
    await crearMedioPago(A, { slug: "huerfano", nombre: "Huérfano" })
    await crearMedioPago(A, { slug: "caro", nombre: "Caro" })
    await crearMedioPago(A, { slug: "barato", nombre: "Barato" })
    await crearMedioPago(A, { slug: "sinlista", nombre: "Sin lista" })
    await actualizarMedioPago(A, "huerfano", { idListaPrecios: "3" })
    await actualizarMedioPago(A, "caro", { idListaPrecios: "4" })
    await actualizarMedioPago(A, "barato", { idListaPrecios: "3" })
    await actualizarMedioPago(A, "sinlista", { destacarEnCatalogo: true, mostrarEnFicha: true })
    // La lista 3 se da de baja sólo para "huerfano": simulamos sacándola de los productos y
    // enlazando otro medio antes. Más simple: borramos el id 3 de los precios.
    await getDb().execute(sql`
      update catalog_products set prices = (
        select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(prices) e where e->>'idPriceList' <> '3'
      )
    `)
    const { medios, listas } = await listarMediosPagoConAvisos(A)
    expect(listas.map((l) => l.idPriceList)).toEqual(["1", "4"])
    const aviso = (slug: string) => medios.find((m) => m.slug === slug)!.avisos
    expect(aviso("huerfano")[0]).toContain("Lista transferencia")
    expect(aviso("caro")[0]).toContain("más cara")
    expect(aviso("barato")[0]).toContain("ya no existe")
    expect(aviso("sinlista")).toHaveLength(2)
  })
})
