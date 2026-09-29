import { describe, it, expect, beforeEach, afterAll, beforeAll } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import {
  actualizarSucursal,
  crearSucursal,
  eliminarSucursal,
  eliminarZona,
  guardarZona,
  listarSucursales,
  listarZonas,
} from "@/lib/sucursales-repo"
import { seedShopOrder, seedTenant, truncateAll } from "./helpers"

/**
 * Repo de sucursales y zonas (change `sucursales-igz-mdp`, A.1.5) contra la base real de test,
 * con las migraciones reales (0041). Datos inventados: tenants `tenant-a` / `tenant-b`, slugs
 * `aaa` / `bbb` / `ccc`.
 */

const A = "tenant-a"
const B = "tenant-b"

const alta = (tenant: string, slug: string, extra: Record<string, unknown> = {}) =>
  crearSucursal(tenant, { slug, nombre: `Sucursal ${slug}`, ...extra })

async function porSlug(tenant: string, slug: string) {
  return (await listarSucursales(tenant)).find((s) => s.slug === slug)
}

let columnaCreadaAca = false

beforeAll(async () => {
  // `shop.orders.sucursal` la agrega la migración 0023 del Shop (otra tarea). Si todavía no está
  // en la base de test, se crea acá sólo para probar el bloqueo del DELETE, y se quita al final.
  const c = await getDb().execute(
    sql`select 1 from information_schema.columns where table_schema = 'shop' and table_name = 'orders' and column_name = 'sucursal'`,
  )
  if (c.length === 0) {
    await getDb().execute(sql`alter table shop.orders add column sucursal text`)
    columnaCreadaAca = true
  }
})

afterAll(async () => {
  await truncateAll()
  if (columnaCreadaAca) await getDb().execute(sql`alter table shop.orders drop column sucursal`)
})

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
  await seedTenant(B)
})

describe("crearSucursal", () => {
  it("alta válida; la primera del tenant queda predeterminada", async () => {
    const r = await alta(A, "aaa", { provincia: "misiones", whatsapp: "+54 9 000 000-0000" })
    expect(r.kind).toBe("ok")
    if (r.kind !== "ok") return
    expect(r.sucursal).toMatchObject({ slug: "aaa", provincia: "Misiones", predeterminada: true, maestra: false, activa: true })

    const segunda = await alta(A, "bbb")
    expect(segunda.kind === "ok" && segunda.sucursal.predeterminada).toBe(false)
  })

  it("slug duplicado en el tenant → conflicto en usted; en otro tenant sí se puede", async () => {
    await alta(A, "aaa")
    expect(await alta(A, "aaa")).toEqual({
      kind: "conflict",
      campo: "slug",
      error: "Ya existe una sucursal con ese identificador.",
    })
    expect((await alta(B, "aaa")).kind).toBe("ok")
    expect(await listarSucursales(A)).toHaveLength(1)
  })

  it("datos inválidos no persisten nada", async () => {
    expect((await alta(A, "A B")).kind).toBe("invalid")
    expect((await alta(A, "aaa", { provincia: "Narnia" })).kind).toBe("invalid")
    expect(await listarSucursales(A)).toHaveLength(0)
  })

  it("una sucursal inactiva no puede ser la predeterminada", async () => {
    expect(await alta(A, "aaa", { activa: false })).toMatchObject({ kind: "invalid", campo: "activa" })
  })
})

describe("transferencia de predeterminada y maestra (una sola por tenant)", () => {
  it("marcar otra como maestra transfiere la marca sin dejar dos", async () => {
    await alta(A, "aaa", { maestra: true })
    await alta(A, "bbb")
    const r = await actualizarSucursal(A, "bbb", { maestra: true })
    expect(r.kind).toBe("ok")

    const todas = await listarSucursales(A)
    expect(todas.filter((s) => s.maestra).map((s) => s.slug)).toEqual(["bbb"])
  })

  it("dar de alta una sucursal maestra baja la anterior", async () => {
    await alta(A, "aaa", { maestra: true })
    await alta(A, "bbb", { maestra: true })
    expect((await listarSucursales(A)).filter((s) => s.maestra).map((s) => s.slug)).toEqual(["bbb"])
  })

  it("la transferencia de un tenant no toca a otro", async () => {
    await alta(A, "aaa", { maestra: true })
    await alta(B, "aaa", { maestra: true })
    await alta(A, "bbb", { maestra: true })
    expect((await porSlug(B, "aaa"))?.maestra).toBe(true)
  })

  it("predeterminada: se transfiere; no se puede desmarcar ni desactivar la vigente", async () => {
    await alta(A, "aaa")
    await alta(A, "bbb")
    expect(await actualizarSucursal(A, "aaa", { predeterminada: false })).toMatchObject({ kind: "invalid", campo: "predeterminada" })
    expect(await actualizarSucursal(A, "aaa", { activa: false })).toMatchObject({ kind: "invalid", campo: "activa" })

    expect((await actualizarSucursal(A, "bbb", { predeterminada: true })).kind).toBe("ok")
    expect((await listarSucursales(A)).filter((s) => s.predeterminada).map((s) => s.slug)).toEqual(["bbb"])
    // Ya con otra predeterminada, la anterior sí se puede desactivar.
    expect((await actualizarSucursal(A, "aaa", { activa: false })).kind).toBe("ok")
  })

  it("dos transferencias simultáneas dejan siempre una sola maestra", async () => {
    await alta(A, "aaa", { maestra: true })
    await alta(A, "bbb")
    await alta(A, "ccc")
    const rs = await Promise.all([
      actualizarSucursal(A, "bbb", { maestra: true }),
      actualizarSucursal(A, "ccc", { maestra: true }),
    ])
    expect(rs.every((r) => r.kind === "ok")).toBe(true)
    expect((await listarSucursales(A)).filter((s) => s.maestra)).toHaveLength(1)
  })
})

describe("actualizarSucursal", () => {
  it("cambios parciales y baja lógica; el slug es inmutable", async () => {
    await alta(A, "aaa")
    await alta(A, "bbb")
    const r = await actualizarSucursal(A, "bbb", { nombre: "Nuevo nombre", activa: false, envioCiudades: ["Ciudad Uno"] })
    expect(r.kind === "ok" && r.sucursal).toMatchObject({ slug: "bbb", nombre: "Nuevo nombre", activa: false, envioCiudades: ["Ciudad Uno"] })
    expect(await actualizarSucursal(A, "bbb", { slug: "ccc" })).toMatchObject({ kind: "invalid", campo: "slug" })
  })

  it("una sucursal de otro tenant se comporta como inexistente", async () => {
    await alta(B, "aaa")
    expect(await actualizarSucursal(A, "aaa", { nombre: "X" })).toEqual({ kind: "not_found" })
    expect((await porSlug(B, "aaa"))?.nombre).toBe("Sucursal aaa")
  })
})

describe("guardarZona / eliminarZona", () => {
  it("alta y cambio de la zona de una provincia (una fila por provincia, con variantes de escritura)", async () => {
    await alta(A, "aaa")
    await alta(A, "bbb")

    expect((await guardarZona(A, { provincia: "misiones", sucursal: "aaa" })).kind).toBe("ok")
    expect((await guardarZona(A, { provincia: " Misiones ", sucursal: "bbb" })).kind).toBe("ok")

    const zonas = await listarZonas(A)
    expect(zonas).toHaveLength(1)
    expect(zonas[0]).toMatchObject({ provinciaClave: "misiones", provincia: "Misiones", sucursal: "bbb", facturaSucursal: null })
  })

  it("zona sin sucursal o con una inexistente → 'Seleccione una sucursal.' y no guarda", async () => {
    await alta(A, "aaa")
    expect(await guardarZona(A, { provincia: "Misiones" })).toEqual({ kind: "invalid", campo: "sucursal", error: "Seleccione una sucursal." })
    expect(await guardarZona(A, { provincia: "Misiones", sucursal: "zzz" })).toEqual({
      kind: "invalid",
      campo: "sucursal",
      error: "Seleccione una sucursal.",
    })
    expect(await listarZonas(A)).toHaveLength(0)
  })

  it("no acepta una sucursal de otro tenant, ni como despacho ni como facturación", async () => {
    await alta(A, "aaa")
    await alta(B, "bbb")
    expect(await guardarZona(A, { provincia: "Chaco", sucursal: "bbb" })).toMatchObject({ kind: "invalid", campo: "sucursal" })
    expect(await guardarZona(A, { provincia: "Chaco", sucursal: "aaa", facturaSucursal: "bbb" })).toMatchObject({
      kind: "invalid",
      campo: "facturaSucursal",
    })
  })

  it("guarda factura_sucursal y elimina la zona (solo la del tenant)", async () => {
    await alta(A, "aaa")
    await alta(A, "bbb")
    const r = await guardarZona(A, { provincia: "Chaco", sucursal: "aaa", facturaSucursal: "bbb" })
    expect(r.kind === "ok" && r.zona.facturaSucursal).toBe("bbb")

    expect(await eliminarZona(B, "chaco")).toEqual({ kind: "not_found" })
    expect(await eliminarZona(A, "chaco")).toEqual({ kind: "ok" })
    expect(await listarZonas(A)).toHaveLength(0)
  })
})

describe("eliminarSucursal", () => {
  it("borra una sucursal sin uso", async () => {
    await alta(A, "aaa")
    await alta(A, "bbb")
    expect(await eliminarSucursal(A, "bbb")).toEqual({ kind: "ok" })
    expect(await porSlug(A, "bbb")).toBeUndefined()
  })

  it("bloquea la predeterminada y la que usa una zona (despacho o facturación)", async () => {
    await alta(A, "aaa")
    await alta(A, "bbb")
    await alta(A, "ccc")
    expect((await eliminarSucursal(A, "aaa")).kind).toBe("conflict")

    await guardarZona(A, { provincia: "Chaco", sucursal: "aaa", facturaSucursal: "bbb" })
    await guardarZona(A, { provincia: "Salta", sucursal: "ccc" })
    expect(await eliminarSucursal(A, "bbb")).toEqual({ kind: "conflict", error: "Hay zonas que usan esta sucursal. Cámbielas antes de eliminarla." })
    expect((await eliminarSucursal(A, "ccc")).kind).toBe("conflict")
  })

  it("bloquea si algún pedido usa el slug; de otro tenant no cuenta; inexistente → not_found", async () => {
    await alta(A, "aaa")
    await alta(A, "bbb")
    await alta(B, "aaa")
    await alta(B, "bbb")
    const pedido = await seedShopOrder(B)
    await getDb().execute(sql`update shop.orders set sucursal = 'bbb' where id = ${pedido.id}`)

    // El pedido es del tenant B: no bloquea el borrado de `bbb` de A.
    expect(await eliminarSucursal(A, "bbb")).toEqual({ kind: "ok" })
    const bloqueada = await eliminarSucursal(B, "bbb")
    expect(bloqueada).toEqual({ kind: "conflict", error: "Hay pedidos asignados a esta sucursal. Desactívela en lugar de eliminarla." })
    expect(await eliminarSucursal(A, "nada")).toEqual({ kind: "not_found" })
  })
})
