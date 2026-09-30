import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { guardarOverlay, listarProductos } from "@/lib/catalogo-overlay-repo"
import { parsearQueryListado } from "@/lib/catalogo-admin"
import { crearSucursal, sonSlugsDeSucursal } from "@/lib/sucursales-repo"
import { seedTenant, truncateAll } from "./helpers"

// Visibilidad por sucursal del overlay del catálogo (change `sucursales-igz-mdp`, rebanada B):
// filtro del listado, badge (dato en el DTO) y validación de slugs. Datos inventados.

const A = "tenant-a"
const B = "tenant-b"
const PRECIO = '[{"idPriceList":"1","name":"General","price":100}]'

const ids = async (filtros: Parameters<typeof listarProductos>[1]) =>
  (await listarProductos(A, filtros, { limit: 200 })).items.map((i) => i.alegraId).sort()

beforeEach(async () => {
  await truncateAll()
  await getDb().execute(sql`truncate table catalog_products, catalog_overlay restart identity cascade`)
  await seedTenant(A)
  await seedTenant(B)
  await crearSucursal(A, { slug: "igz", nombre: "Iguazú" })
  await crearSucursal(A, { slug: "mdp", nombre: "Mar del Plata" })
  await crearSucursal(B, { slug: "otra", nombre: "Otra" })
  for (const id of ["1", "2", "3"]) {
    await getDb().execute(
      sql`INSERT INTO catalog_products (tenant_id, alegra_id, code, name, prices, stock) VALUES (${A}, ${id}, ${"C" + id}, ${"Producto " + id}, ${PRECIO}::jsonb, 5)`,
    )
  }
  // 1: sin overlay (visible en todas). 2: oculto en mdp. 3: oculto en las dos.
  await guardarOverlay(A, "2", { visible: true, ocultoEnSucursales: ["mdp"] })
  await guardarOverlay(A, "3", { visible: true, ocultoEnSucursales: ["igz", "mdp"] })
})

afterAll(async () => {
  await truncateAll()
})

describe("filtro del listado por visibilidad en sucursal", () => {
  it("visible:mdp deja los que no la ocultan (incluye los sin overlay)", async () => {
    expect(await ids({ sucursal: "visible:mdp" })).toEqual(["1"])
    expect(await ids({ sucursal: "visible:igz" })).toEqual(["1", "2"])
  })

  it("oculto:mdp deja los que la ocultan", async () => {
    expect(await ids({ sucursal: "oculto:mdp" })).toEqual(["2", "3"])
    expect(await ids({ sucursal: "oculto:igz" })).toEqual(["3"])
  })

  it("sin filtro lista todo, y el DTO trae los slugs para el badge", async () => {
    expect(await ids({})).toEqual(["1", "2", "3"])
    const { items } = await listarProductos(A, {}, { limit: 200 })
    expect(items.find((i) => i.alegraId === "1")?.ocultoEnSucursales).toEqual([])
    expect(items.find((i) => i.alegraId === "3")?.ocultoEnSucursales).toEqual(["igz", "mdp"])
  })

  it("una sucursal que no existe no rompe: visible:zzz deja todo, oculto:zzz no deja nada", async () => {
    expect(await ids({ sucursal: "visible:zzz" })).toEqual(["1", "2", "3"])
    expect(await ids({ sucursal: "oculto:zzz" })).toEqual([])
  })

  it("el parser de la query valida el formato del filtro", () => {
    const ok = parsearQueryListado(new URL("http://x/?sucursal=oculto:mdp"))
    expect(ok instanceof Response ? null : ok.filtros.sucursal).toBe("oculto:mdp")
    const malo = parsearQueryListado(new URL("http://x/?sucursal=otro:mdp"))
    expect(malo instanceof Response && malo.status).toBe(400)
  })
})

describe("sonSlugsDeSucursal", () => {
  it("acepta slugs del tenant (activos o dados de baja) y la lista vacía", async () => {
    expect(await sonSlugsDeSucursal(A, [])).toBe(true)
    expect(await sonSlugsDeSucursal(A, ["igz", "mdp"])).toBe(true)
    await getDb().execute(sql`UPDATE sucursales SET activa = false WHERE tenant_id = ${A} AND slug = 'mdp'`)
    expect(await sonSlugsDeSucursal(A, ["mdp"])).toBe(true)
  })

  it("rechaza un slug inexistente o de otro tenant", async () => {
    expect(await sonSlugsDeSucursal(A, ["igz", "nada"])).toBe(false)
    expect(await sonSlugsDeSucursal(A, ["otra"])).toBe(false)
    expect(await sonSlugsDeSucursal(B, ["otra"])).toBe(true)
  })
})
