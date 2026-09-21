import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { and, eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { getDb } from "@/db"
import { catalogOverlay, catalogProducts, shopCategories, shopTags } from "@/db/schema"
import { asignarTagsProducto, crearCategoria, crearTag, guardarOverlay } from "@/lib/catalogo-overlay-repo"
import { seedOperator, seedTenant, truncateAll } from "./helpers"

// L6 — API del panel de catálogo, taxonomía (categorías y etiquetas). DB real (crm_test).
//
// Lo que protegen estos tests:
//   1. Aislamiento entre tenants en las seis rutas: un id ajeno se comporta como inexistente.
//   2. Borrar una categoría informa el impacto ANTES y no despublica ni borra productos.
//   3. Renombrar una etiqueta no toca ninguna fila de producto; borrarla sí las arrastra.
//   4. El reorden es una sola llamada con el nivel completo, y un conjunto viejo es 409.

let session: Record<string, unknown>

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))

const categorias = await import("@/app/api/admin/catalogo/categorias/route")
const categoria = await import("@/app/api/admin/catalogo/categorias/[id]/route")
const orden = await import("@/app/api/admin/catalogo/categorias/orden/route")
const tags = await import("@/app/api/admin/catalogo/tags/route")
const tag = await import("@/app/api/admin/catalogo/tags/[id]/route")

const TENANT_A = "tenant-a"
const TENANT_B = "tenant-b"
const NOT_FOUND_BODY = { error: "No encontrado", code: "not_found" }

function login(userId: string, tenantId = TENANT_A) {
  session = { userId, role: "admin", tenantId, name: "Ana", email: "ana@example.com", save: async () => {} }
}

const req = (path: string, init: { method?: string; body?: unknown; host?: string } = {}) => {
  const host = init.host ?? TENANT_A
  return new NextRequest(`http://${host}.localhost${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    headers: { host: `${host}.localhost` },
  })
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })

async function seedProducto(tenantId: string, alegraId: string) {
  await getDb().insert(catalogProducts).values({
    tenantId,
    alegraId,
    name: `COD-${alegraId}`,
    description: `Producto ${alegraId}`,
    prices: [{ idPriceList: "1", name: "General", price: 1500 }],
    status: "active",
  })
}

const updatedAtDe = async (alegraId: string): Promise<Date> => {
  const [row] = await getDb()
    .select({ updatedAt: catalogOverlay.updatedAt })
    .from(catalogOverlay)
    .where(and(eq(catalogOverlay.tenantId, TENANT_A), eq(catalogOverlay.alegraId, alegraId)))
  return row.updatedAt
}

let adminA: string
let operador: string

describe("API del panel de catálogo — categorías y etiquetas", () => {
  beforeEach(async () => {
    await truncateAll()
    await seedTenant(TENANT_A)
    await seedTenant(TENANT_B)
    adminA = await seedOperator(TENANT_A, { role: "admin", email: "a@example.com" })
    operador = await seedOperator(TENANT_A, { role: "operator", email: "op@example.com" })
    login(adminA)
  })

  afterAll(async () => {
    await truncateAll()
  })

  describe("autorización y aislamiento", () => {
    it("operator → 404 en todas las rutas, con el mismo cuerpo que un id inexistente", async () => {
      const cat = await crearCategoria(TENANT_A, { nombre: "Electricidad" })
      if (cat.kind !== "ok") throw new Error("seed")
      login(operador)

      const respuestas = [
        await categorias.GET(req("/api/admin/catalogo/categorias")),
        await categoria.GET(req(`/api/admin/catalogo/categorias/${cat.row.id}`), params(cat.row.id)),
        await categoria.DELETE(req(`/api/admin/catalogo/categorias/${cat.row.id}`, { method: "DELETE" }), params(cat.row.id)),
        await tags.GET(req("/api/admin/catalogo/tags")),
      ]
      for (const res of respuestas) expect(res.status).toBe(404)
      expect(await respuestas[1].json()).toEqual(NOT_FOUND_BODY)
    })

    it("una categoría de otro tenant no se puede ver, editar ni borrar", async () => {
      const ajena = await crearCategoria(TENANT_B, { nombre: "Ajena" })
      if (ajena.kind !== "ok") throw new Error("seed")

      for (const res of [
        await categoria.GET(req(`/api/admin/catalogo/categorias/${ajena.row.id}`), params(ajena.row.id)),
        await categoria.PATCH(
          req(`/api/admin/catalogo/categorias/${ajena.row.id}`, { method: "PATCH", body: { nombre: "Robada" } }),
          params(ajena.row.id),
        ),
        await categoria.DELETE(req(`/api/admin/catalogo/categorias/${ajena.row.id}`, { method: "DELETE" }), params(ajena.row.id)),
      ]) {
        expect(res.status).toBe(404)
      }
      const [sigue] = await getDb().select().from(shopCategories).where(eq(shopCategories.id, ajena.row.id))
      expect(sigue.nombre).toBe("Ajena")
    })

    it("una etiqueta de otro tenant no se puede renombrar ni borrar", async () => {
      const ajena = await crearTag(TENANT_B, { nombre: "Ajena" })
      if (ajena.kind !== "ok") throw new Error("seed")

      expect(
        (await tag.PATCH(req(`/api/admin/catalogo/tags/${ajena.row.id}`, { method: "PATCH", body: { nombre: "Robada" } }), params(ajena.row.id))).status,
      ).toBe(404)
      expect((await tag.DELETE(req(`/api/admin/catalogo/tags/${ajena.row.id}`, { method: "DELETE" }), params(ajena.row.id))).status).toBe(404)
      const [sigue] = await getDb().select().from(shopTags).where(eq(shopTags.id, ajena.row.id))
      expect(sigue.nombre).toBe("Ajena")
    })

    it("el árbol y el listado de etiquetas sólo traen lo del tenant del guard", async () => {
      await crearCategoria(TENANT_A, { nombre: "Propia" })
      await crearCategoria(TENANT_B, { nombre: "Ajena" })
      await crearTag(TENANT_A, { nombre: "Oferta" })
      await crearTag(TENANT_B, { nombre: "Ajena" })

      const arbol = (await (await categorias.GET(req("/api/admin/catalogo/categorias"))).json()) as {
        categorias: { nombre: string }[]
      }
      expect(arbol.categorias.map((c) => c.nombre)).toEqual(["Propia"])
      const lista = (await (await tags.GET(req("/api/admin/catalogo/tags"))).json()) as { tags: { nombre: string }[] }
      expect(lista.tags.map((t) => t.nombre)).toEqual(["Oferta"])
    })

    it("no se puede colgar una categoría de un padre de otro tenant", async () => {
      const ajena = await crearCategoria(TENANT_B, { nombre: "Ajena" })
      if (ajena.kind !== "ok") throw new Error("seed")

      const res = await categorias.POST(
        req("/api/admin/catalogo/categorias", { body: { nombre: "Hija", parentId: ajena.row.id } }),
      )
      expect(res.status).toBe(422)
      expect(await getDb().select().from(shopCategories).where(eq(shopCategories.tenantId, TENANT_A))).toHaveLength(0)
    })
  })

  describe("ABM de categorías", () => {
    it("rechaza el cuarto nivel y el slug repetido entre hermanas, pero permite el mismo nombre bajo padres distintos", async () => {
      const a = await crearCategoria(TENANT_A, { nombre: "Electricidad" })
      if (a.kind !== "ok") throw new Error("seed")
      const b = await crearCategoria(TENANT_A, { nombre: "Cables", parentId: a.row.id })
      if (b.kind !== "ok") throw new Error("seed")
      const c = await crearCategoria(TENANT_A, { nombre: "Unipolares", parentId: b.row.id })
      if (c.kind !== "ok") throw new Error("seed")

      const cuarto = await categorias.POST(
        req("/api/admin/catalogo/categorias", { body: { nombre: "Más hondo", parentId: c.row.id } }),
      )
      expect(cuarto.status).toBe(422)
      expect(((await cuarto.json()) as { error: string }).error).toMatch(/3 niveles/)

      const repetida = await categorias.POST(
        req("/api/admin/catalogo/categorias", { body: { nombre: "Cables", parentId: a.row.id } }),
      )
      expect(repetida.status).toBe(422)
      expect(((await repetida.json()) as { code: string }).code).toBe("duplicado")

      const redes = await crearCategoria(TENANT_A, { nombre: "Redes" })
      if (redes.kind !== "ok") throw new Error("seed")
      const otra = await categorias.POST(
        req("/api/admin/catalogo/categorias", { body: { nombre: "Cables", parentId: redes.row.id } }),
      )
      expect(otra.status).toBe(201)
    })

    it("el árbol trae también las categorías vacías, con conteo 0", async () => {
      await crearCategoria(TENANT_A, { nombre: "Vacía" })
      const body = (await (await categorias.GET(req("/api/admin/catalogo/categorias"))).json()) as {
        categorias: { nombre: string; productos: number }[]
      }
      expect(body.categorias).toEqual([expect.objectContaining({ nombre: "Vacía", productos: 0 })])
    })

    it("informa el impacto del borrado antes de confirmar y no borra ni despublica productos", async () => {
      const cat = await crearCategoria(TENANT_A, { nombre: "Cables" })
      if (cat.kind !== "ok") throw new Error("seed")
      await seedProducto(TENANT_A, "1")
      await seedProducto(TENANT_A, "2")
      await guardarOverlay(TENANT_A, "1", { visible: true, nombre: "Cable 2.5", categoriaId: cat.row.id })
      await guardarOverlay(TENANT_A, "2", { categoriaId: cat.row.id })

      const impacto = (await (await categoria.GET(req(`/api/admin/catalogo/categorias/${cat.row.id}`), params(cat.row.id))).json()) as {
        impacto: { productos: number; hijas: number }
      }
      expect(impacto.impacto).toEqual({ productos: 2, hijas: 0 })

      const antes = await updatedAtDe("1")
      const res = await categoria.DELETE(req(`/api/admin/catalogo/categorias/${cat.row.id}`, { method: "DELETE" }), params(cat.row.id))
      expect(res.status).toBe(200)

      const filas = await getDb().select().from(catalogOverlay).where(eq(catalogOverlay.tenantId, TENANT_A))
      expect(filas).toHaveLength(2)
      const uno = filas.find((f) => f.alegraId === "1")!
      expect(uno.categoriaId).toBeNull()
      expect(uno.visible).toBe(true) // borrar una categoría NO despublica
      expect(uno.nombre).toBe("Cable 2.5")
      // …y el cambio viaja: la marca temporal avanzó ANTES del DELETE.
      expect((await updatedAtDe("1")).getTime()).toBeGreaterThan(antes.getTime())
    })

    it("borrar una categoría con hijas es 409 y no deja nada a medias", async () => {
      const padre = await crearCategoria(TENANT_A, { nombre: "Electricidad" })
      if (padre.kind !== "ok") throw new Error("seed")
      await crearCategoria(TENANT_A, { nombre: "Cables", parentId: padre.row.id })

      const res = await categoria.DELETE(req(`/api/admin/catalogo/categorias/${padre.row.id}`, { method: "DELETE" }), params(padre.row.id))
      expect(res.status).toBe(409)
      expect(((await res.json()) as { code: string }).code).toBe("con_hijas")
      expect(await getDb().select().from(shopCategories).where(eq(shopCategories.tenantId, TENANT_A))).toHaveLength(2)

      const impacto = (await (await categoria.GET(req(`/api/admin/catalogo/categorias/${padre.row.id}`), params(padre.row.id))).json()) as {
        impacto: { hijas: number }
      }
      expect(impacto.impacto.hijas).toBe(1)
    })

    it("reordenar un nivel es UNA llamada con todos los hermanos; un conjunto parcial es 409", async () => {
      const ids: string[] = []
      for (const nombre of ["A", "B", "C"]) {
        const c = await crearCategoria(TENANT_A, { nombre })
        if (c.kind !== "ok") throw new Error("seed")
        ids.push(c.row.id)
      }
      const [a, b, c] = ids

      const parcial = await orden.PATCH(
        req("/api/admin/catalogo/categorias/orden", { method: "PATCH", body: { parentId: null, ids: [a, b] } }),
      )
      expect(parcial.status).toBe(409)

      const res = await orden.PATCH(
        req("/api/admin/catalogo/categorias/orden", { method: "PATCH", body: { parentId: null, ids: [a, c, b] } }),
      )
      expect(res.status).toBe(200)
      const filas = await getDb().select().from(shopCategories).where(eq(shopCategories.tenantId, TENANT_A))
      const porId = new Map(filas.map((f) => [f.id, f.orden]))
      expect([porId.get(a), porId.get(c), porId.get(b)]).toEqual([0, 1, 2])
    })
  })

  describe("ABM de etiquetas", () => {
    it("alta con nombre duplicado (incluso con otra capitalización) se rechaza", async () => {
      expect((await tags.POST(req("/api/admin/catalogo/tags", { body: { nombre: "Oferta" } }))).status).toBe(201)
      const dup = await tags.POST(req("/api/admin/catalogo/tags", { body: { nombre: "  OFERTA " } }))
      expect(dup.status).toBe(422)
      expect(((await dup.json()) as { code: string }).code).toBe("duplicado")
      expect(await getDb().select().from(shopTags).where(eq(shopTags.tenantId, TENANT_A))).toHaveLength(1)
    })

    it("la misma etiqueta en dos tenants no colisiona", async () => {
      await crearTag(TENANT_B, { nombre: "Oferta" })
      expect((await tags.POST(req("/api/admin/catalogo/tags", { body: { nombre: "Oferta" } }))).status).toBe(201)
    })

    it("lista con el conteo exacto de productos, incluidas las que no usa nadie", async () => {
      const oferta = await crearTag(TENANT_A, { nombre: "Oferta" })
      await crearTag(TENANT_A, { nombre: "Nuevo" })
      if (oferta.kind !== "ok") throw new Error("seed")
      for (const id of ["1", "2"]) {
        await seedProducto(TENANT_A, id)
        await asignarTagsProducto(TENANT_A, id, [oferta.row.id])
      }

      const body = (await (await tags.GET(req("/api/admin/catalogo/tags"))).json()) as {
        tags: { nombre: string; productos: number }[]
      }
      expect(body.tags).toEqual([
        expect.objectContaining({ nombre: "Nuevo", productos: 0 }),
        expect.objectContaining({ nombre: "Oferta", productos: 2 }),
      ])
    })

    it("renombrar NO toca ninguna fila de producto", async () => {
      const t = await crearTag(TENANT_A, { nombre: "Oferta" })
      if (t.kind !== "ok") throw new Error("seed")
      await seedProducto(TENANT_A, "1")
      await asignarTagsProducto(TENANT_A, "1", [t.row.id])
      const antes = await updatedAtDe("1")

      const res = await tag.PATCH(
        req(`/api/admin/catalogo/tags/${t.row.id}`, { method: "PATCH", body: { nombre: "Liquidación" } }),
        params(t.row.id),
      )
      expect(res.status).toBe(200)
      expect(((await res.json()) as { tag: { slug: string } }).tag.slug).toBe("liquidacion")
      // Es el punto entero de que las etiquetas tengan entidad propia: el rename no infla el delta.
      expect((await updatedAtDe("1")).getTime()).toBe(antes.getTime())
    })

    it("renombrar a un nombre ya usado se rechaza y no cambia ninguna de las dos", async () => {
      const a = await crearTag(TENANT_A, { nombre: "Oferta" })
      await crearTag(TENANT_A, { nombre: "Liquidación" })
      if (a.kind !== "ok") throw new Error("seed")

      const res = await tag.PATCH(
        req(`/api/admin/catalogo/tags/${a.row.id}`, { method: "PATCH", body: { nombre: "Liquidación" } }),
        params(a.row.id),
      )
      expect(res.status).toBe(422)
      const [fila] = await getDb().select().from(shopTags).where(eq(shopTags.id, a.row.id))
      expect(fila.nombre).toBe("Oferta")
    })

    it("borrar informa el impacto antes, saca la etiqueta de sus productos y los arrastra al delta", async () => {
      const t = await crearTag(TENANT_A, { nombre: "Descontinuado" })
      const otro = await crearTag(TENANT_A, { nombre: "Oferta" })
      if (t.kind !== "ok" || otro.kind !== "ok") throw new Error("seed")
      await seedProducto(TENANT_A, "1")
      await guardarOverlay(TENANT_A, "1", { visible: true, nombre: "Cable 2.5" })
      await asignarTagsProducto(TENANT_A, "1", [t.row.id, otro.row.id])
      const antes = await updatedAtDe("1")

      const impacto = (await (await tag.GET(req(`/api/admin/catalogo/tags/${t.row.id}`), params(t.row.id))).json()) as {
        impacto: { productos: number }
      }
      expect(impacto.impacto.productos).toBe(1)

      expect((await tag.DELETE(req(`/api/admin/catalogo/tags/${t.row.id}`, { method: "DELETE" }), params(t.row.id))).status).toBe(200)

      const [fila] = await getDb().select().from(catalogOverlay).where(eq(catalogOverlay.alegraId, "1"))
      expect(fila.visible).toBe(true)
      expect(fila.nombre).toBe("Cable 2.5")
      expect((await updatedAtDe("1")).getTime()).toBeGreaterThan(antes.getTime())
      // La otra etiqueta del producto sobrevive.
      const restantes = await getDb().select().from(shopTags).where(eq(shopTags.tenantId, TENANT_A))
      expect(restantes.map((r) => r.nombre)).toEqual(["Oferta"])
    })
  })
})
