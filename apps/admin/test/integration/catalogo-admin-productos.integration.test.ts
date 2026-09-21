import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { and, eq } from "drizzle-orm"
import { NextRequest } from "next/server"
import { getDb } from "@/db"
import { catalogOverlay, catalogProducts, shopCategories, shopTags } from "@/db/schema"
import { crearCategoria, guardarOverlay } from "@/lib/catalogo-overlay-repo"
import { seedOperator, seedTenant, truncateAll } from "./helpers"

// L6 — API del panel de catálogo, productos. DB real (crm_test), guard real (requireAdminPlus:
// rol y tenant salen de la FILA de admin_users, no de la cookie).
//
// Lo que protegen estos tests, en orden de gravedad:
//   1. Aislamiento entre tenants: hay antecedente de un bug de aislamiento en /admin. Un
//      producto, una categoría o una etiqueta de otro tenant tienen que comportarse como
//      inexistentes, nunca como editables.
//   2. El listado resuelve todo en Postgres: conteo de la intersección de filtros, subárbol de
//      categorías, paginación sin repetir ni saltear.
//   3. El PATCH persiste SÓLO lo enviado y no existe forma de tocar precio ni stock.
//   4. La masiva por filtro afecta a todo el conjunto (no a la página) y el número lo cuenta el
//      servidor.

let session: Record<string, unknown>

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))

const productos = await import("@/app/api/admin/catalogo/productos/route")
const producto = await import("@/app/api/admin/catalogo/productos/[alegraId]/route")
const masiva = await import("@/app/api/admin/catalogo/productos/masiva/route")
const contar = await import("@/app/api/admin/catalogo/productos/masiva/contar/route")

const TENANT_A = "tenant-a"
const TENANT_B = "tenant-b"
const PRECIO = [{ idPriceList: "1", name: "General", price: 1500 }]
const NOT_FOUND_BODY = { error: "No encontrado", code: "not_found" }

function login(userId: string, opts: { tenantId?: string } = {}) {
  session = {
    userId,
    role: "admin",
    tenantId: opts.tenantId ?? TENANT_A,
    name: "Ana Admin",
    email: "ana.admin@example.com",
    save: async () => {},
  }
}

const req = (path: string, init: { method?: string; body?: unknown; host?: string } = {}) => {
  const host = init.host ?? TENANT_A
  return new NextRequest(`http://${host}.localhost${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    headers: { host: `${host}.localhost` },
  })
}

const params = (alegraId: string) => ({ params: Promise.resolve({ alegraId }) })

const listar = async (query = "", host = TENANT_A) => {
  const res = await productos.GET(req(`/api/admin/catalogo/productos${query}`, { host }))
  return { status: res.status, body: (await res.json()) as { items: { alegraId: string }[]; total: number } }
}

async function seedProducto(tenantId: string, alegraId: string, extra: Partial<typeof catalogProducts.$inferInsert> = {}) {
  await getDb()
    .insert(catalogProducts)
    .values({
      tenantId,
      alegraId,
      name: `COD-${alegraId}`,
      description: `Producto ${alegraId}`,
      prices: PRECIO,
      status: "active",
      ...extra,
    })
}

let adminA: string
let adminB: string
let operador: string

describe("API del panel de catálogo — productos", () => {
  beforeEach(async () => {
    await truncateAll()
    await seedTenant(TENANT_A)
    await seedTenant(TENANT_B)
    adminA = await seedOperator(TENANT_A, { role: "admin", email: "a@example.com" })
    adminB = await seedOperator(TENANT_B, { role: "admin", email: "b@example.com" })
    operador = await seedOperator(TENANT_A, { role: "operator", email: "op@example.com" })
    login(adminA)
  })

  afterAll(async () => {
    await truncateAll()
  })

  describe("autorización", () => {
    it("sin sesión → 401 en todas las rutas, sin filtrar catálogo", async () => {
      await seedProducto(TENANT_A, "1", { description: "Térmica bipolar 16A" })
      session = {}

      const rutas = [
        productos.GET(req("/api/admin/catalogo/productos")),
        producto.GET(req("/api/admin/catalogo/productos/1"), params("1")),
        producto.PATCH(req("/api/admin/catalogo/productos/1", { method: "PATCH", body: { visible: true } }), params("1")),
        masiva.POST(req("/api/admin/catalogo/productos/masiva", { body: { seleccion: { tipo: "ids", alegraIds: ["1"] }, accion: { tipo: "visible", valor: true } } })),
        contar.POST(req("/api/admin/catalogo/productos/masiva/contar", { body: { seleccion: { tipo: "ids", alegraIds: ["1"] } } })),
      ]
      for (const p of rutas) {
        const res = await p
        expect(res.status).toBe(401)
        expect(JSON.stringify(await res.json())).not.toMatch(/Térmica/)
      }
    })

    it("operator → 404 con el mismo cuerpo que un producto inexistente", async () => {
      await seedProducto(TENANT_A, "1")
      login(operador)

      const res = await producto.GET(req("/api/admin/catalogo/productos/1"), params("1"))
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual(NOT_FOUND_BODY)

      login(adminA)
      const inexistente = await producto.GET(req("/api/admin/catalogo/productos/9999"), params("9999"))
      expect(inexistente.status).toBe(404)
      expect(await inexistente.json()).toEqual(NOT_FOUND_BODY)
    })
  })

  describe("aislamiento entre tenants", () => {
    it("el listado sólo trae productos del tenant del guard", async () => {
      await seedProducto(TENANT_A, "1")
      await seedProducto(TENANT_B, "2")

      const a = await listar()
      expect(a.body.total).toBe(1)
      expect(a.body.items.map((i) => i.alegraId)).toEqual(["1"])

      login(adminB, { tenantId: TENANT_B })
      const b = await listar("", TENANT_B)
      expect(b.body.items.map((i) => i.alegraId)).toEqual(["2"])
    })

    it("editar un producto de otro tenant es un 404 y no modifica nada", async () => {
      await seedProducto(TENANT_B, "2")
      const res = await producto.PATCH(
        req("/api/admin/catalogo/productos/2", { method: "PATCH", body: { nombre: "Robado" } }),
        params("2"),
      )
      expect(res.status).toBe(404)
      const [fila] = await getDb().select().from(catalogOverlay).where(eq(catalogOverlay.alegraId, "2"))
      expect(fila).toBeUndefined()
    })

    it("asignar una categoría de otro tenant se rechaza (la FK sola no alcanza)", async () => {
      await seedProducto(TENANT_A, "1")
      const [ajena] = await getDb()
        .insert(shopCategories)
        .values({ tenantId: TENANT_B, nombre: "Ajena", slug: "ajena" })
        .returning()

      const res = await producto.PATCH(
        req("/api/admin/catalogo/productos/1", { method: "PATCH", body: { categoriaId: ajena.id } }),
        params("1"),
      )
      expect(res.status).toBe(422)
      expect((await res.json()).campo).toBe("categoriaId")

      const masivaRes = await masiva.POST(
        req("/api/admin/catalogo/productos/masiva", {
          body: { seleccion: { tipo: "ids", alegraIds: ["1"] }, accion: { tipo: "categoria", categoriaId: ajena.id } },
        }),
      )
      expect(masivaRes.status).toBe(422)

      const [fila] = await getDb().select().from(catalogOverlay).where(eq(catalogOverlay.alegraId, "1"))
      expect(fila?.categoriaId ?? null).toBeNull()
    })

    it("una etiqueta de otro tenant no se asigna", async () => {
      await seedProducto(TENANT_A, "1")
      const [ajena] = await getDb()
        .insert(shopTags)
        .values({ tenantId: TENANT_B, nombre: "Ajena", slug: "ajena" })
        .returning()

      const res = await producto.PATCH(
        req("/api/admin/catalogo/productos/1", { method: "PATCH", body: { tagIds: [ajena.id] } }),
        params("1"),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).producto.tagIds).toEqual([])
    })
  })

  describe("listado", () => {
    it("filtra por sin foto, sin clasificar y estado, y el conteo es el de la intersección", async () => {
      for (const id of ["1", "2", "3", "4"]) await seedProducto(TENANT_A, id)
      const cat = await crearCategoria(TENANT_A, { nombre: "Electricidad" })
      if (cat.kind !== "ok") throw new Error("seed")
      await guardarOverlay(TENANT_A, "1", { visible: true, categoriaId: cat.row.id, fotos: [{ key: "a.webp", w: 800 }] })
      await guardarOverlay(TENANT_A, "2", { visible: true })

      expect((await listar("?foto=sin")).body.total).toBe(3)
      expect((await listar("?foto=con")).body.total).toBe(1)
      expect((await listar("?categoria=sin")).body.total).toBe(3)
      expect((await listar("?estado=visible")).body.total).toBe(2)
      expect((await listar("?estado=oculto")).body.total).toBe(2)
      // Intersección: publicados y sin foto ⇒ sólo el 2.
      const inter = await listar("?estado=visible&foto=sin")
      expect(inter.body.total).toBe(1)
      expect(inter.body.items.map((i) => i.alegraId)).toEqual(["2"])
    })

    it("filtrar por una categoría padre trae el subárbol", async () => {
      const padre = await crearCategoria(TENANT_A, { nombre: "Electricidad" })
      if (padre.kind !== "ok") throw new Error("seed")
      const hija = await crearCategoria(TENANT_A, { nombre: "Cables", parentId: padre.row.id })
      if (hija.kind !== "ok") throw new Error("seed")

      await seedProducto(TENANT_A, "1")
      await seedProducto(TENANT_A, "2")
      await seedProducto(TENANT_A, "3")
      await guardarOverlay(TENANT_A, "1", { categoriaId: padre.row.id })
      await guardarOverlay(TENANT_A, "2", { categoriaId: hija.row.id })

      expect((await listar(`?categoria=${padre.row.id}`)).body.total).toBe(2)
      expect((await listar(`?categoria=${hija.row.id}`)).body.total).toBe(1)
      expect((await listar("?categoria=sin")).body.total).toBe(1)
    })

    it("busca por nombre propio, por descripción de Alegra y por el código viejo", async () => {
      await seedProducto(TENANT_A, "1", { name: "JDSDA261", description: "TERMICA 2X16" })
      await seedProducto(TENANT_A, "2", { name: "OTRO", description: "CABLE 2.5" })
      await guardarOverlay(TENANT_A, "1", { nombre: "Térmica bipolar 16A" })

      expect((await listar("?q=bipolar")).body.items.map((i) => i.alegraId)).toEqual(["1"])
      expect((await listar("?q=JDSDA261")).body.items.map((i) => i.alegraId)).toEqual(["1"])
      expect((await listar("?q=termica")).body.items.map((i) => i.alegraId)).toEqual(["1"])
      expect((await listar("?q=cable")).body.items.map((i) => i.alegraId)).toEqual(["2"])
    })

    it("paginación estable: sin repetir ni saltear entre páginas", async () => {
      for (const id of ["1", "2", "3", "4", "5"]) await seedProducto(TENANT_A, id)

      const p1 = await listar("?limit=2&start=0")
      const p2 = await listar("?limit=2&start=2")
      const p3 = await listar("?limit=2&start=4")
      const vistos = [...p1.body.items, ...p2.body.items, ...p3.body.items].map((i) => i.alegraId)
      expect(p1.body.total).toBe(5)
      expect(new Set(vistos).size).toBe(5)
      // Volver a la primera página da exactamente lo mismo.
      expect((await listar("?limit=2&start=0")).body.items).toEqual(p1.body.items)
    })

    it("el payload es proporcional a la página, no al catálogo", async () => {
      for (let i = 0; i < 25; i++) await seedProducto(TENANT_A, String(100 + i))
      const r = await listar("?limit=10")
      expect(r.body.total).toBe(25)
      expect(r.body.items).toHaveLength(10)
    })

    it("una combinación sin resultados devuelve una lista vacía con total 0, no un error", async () => {
      await seedProducto(TENANT_A, "1")
      const r = await listar("?estado=visible&foto=con")
      expect(r.status).toBe(200)
      expect(r.body.total).toBe(0)
      expect(r.body.items).toEqual([])
    })

    it("un filtro con un valor fuera de dominio es 400 con mensaje en español formal", async () => {
      for (const q of ["?estado=cualquiera", "?foto=quizas", "?categoria=no-es-uuid", "?limit=0", "?start=-1", "?precio=gratis", "?orden=random"]) {
        const res = await productos.GET(req(`/api/admin/catalogo/productos${q}`))
        expect(res.status).toBe(400)
        const body = (await res.json()) as { error: string }
        expect(body.error).toMatch(/^(El|La)\s/)
      }
    })

    it("filtra por productos sin precio en Alegra", async () => {
      await seedProducto(TENANT_A, "1")
      await seedProducto(TENANT_A, "2", { prices: [] })
      await seedProducto(TENANT_A, "3", { prices: [{ idPriceList: "1", name: "General", price: 0 }] })

      const sin = await listar("?precio=sin")
      expect(sin.body.total).toBe(2)
      expect(sin.body.items.map((i) => i.alegraId).sort()).toEqual(["2", "3"])
      expect((await listar("?precio=con")).body.items.map((i) => i.alegraId)).toEqual(["1"])
    })

    it("un overlay sin producto espejado no rompe el listado", async () => {
      await seedProducto(TENANT_A, "1")
      await guardarOverlay(TENANT_A, "huerfano", { visible: true, nombre: "Sin espejo" })

      const r = await listar()
      expect(r.status).toBe(200)
      expect(r.body.total).toBe(1)
      expect(r.body.items.map((i) => i.alegraId)).toEqual(["1"])
    })

    it("informa la frescura: sync de Alegra y último aviso entregado a la tienda", async () => {
      await seedProducto(TENANT_A, "1")
      const res = await productos.GET(req("/api/admin/catalogo/productos"))
      const body = (await res.json()) as { sincronizacion: { alegra: string | null; avisoShop: { ultimoOkAt: string | null } } }
      // Sin corridas ni avisos, las dos son null: la UI dice "Desconocida", no una fecha inventada.
      expect(body.sincronizacion.alegra).toBeNull()
      expect(body.sincronizacion.avisoShop.ultimoOkAt).toBeNull()
    })
  })

  describe("ficha y edición", () => {
    it("la ficha trae lo de Alegra y lo editable, con el nombre resuelto", async () => {
      await seedProducto(TENANT_A, "1", { name: "JDSDA261", description: "TERMICA 2X16", stock: "7" })

      const res = await producto.GET(req("/api/admin/catalogo/productos/1"), params("1"))
      const { producto: p } = (await res.json()) as { producto: Record<string, unknown> }
      expect(p.nombreEfectivo).toBe("TERMICA 2X16")
      expect(p.sku).toBe("JDSDA261")
      expect(p.stock).toBe("7")
      expect(p.visible).toBe(false)
      expect(p.motivos).toEqual(["oculto"])
    })

    it("guardar sólo el nombre no toca categoría, etiquetas ni fotos", async () => {
      await seedProducto(TENANT_A, "1")
      const cat = await crearCategoria(TENANT_A, { nombre: "Electricidad" })
      if (cat.kind !== "ok") throw new Error("seed")
      const [tag] = await getDb().insert(shopTags).values({ tenantId: TENANT_A, nombre: "Oferta", slug: "oferta" }).returning()
      await guardarOverlay(TENANT_A, "1", {
        visible: true,
        categoriaId: cat.row.id,
        fotos: [{ key: "a.webp", w: 800 }],
      })
      await producto.PATCH(
        req("/api/admin/catalogo/productos/1", { method: "PATCH", body: { tagIds: [tag.id] } }),
        params("1"),
      )
      const antes = await updatedAt("1")

      const res = await producto.PATCH(
        req("/api/admin/catalogo/productos/1", { method: "PATCH", body: { nombre: "Térmica bipolar 16A" } }),
        params("1"),
      )
      expect(res.status).toBe(200)
      const { producto: p } = (await res.json()) as { producto: Record<string, unknown> }
      expect(p.nombre).toBe("Térmica bipolar 16A")
      expect(p.visible).toBe(true)
      expect(p.categoriaId).toBe(cat.row.id)
      expect(p.tagIds).toEqual([tag.id])
      expect(p.fotos).toHaveLength(1)
      expect((await updatedAt("1")).getTime()).toBeGreaterThan(antes.getTime())
    })

    it("vaciar el nombre propio vuelve al de Alegra y no es un error de validación", async () => {
      await seedProducto(TENANT_A, "1", { name: "JDSDA261", description: "TERMICA 2X16" })
      await guardarOverlay(TENANT_A, "1", { nombre: "Térmica bipolar 16A" })

      const res = await producto.PATCH(
        req("/api/admin/catalogo/productos/1", { method: "PATCH", body: { nombre: "   " } }),
        params("1"),
      )
      expect(res.status).toBe(200)
      const { producto: p } = (await res.json()) as { producto: Record<string, unknown> }
      expect(p.nombre).toBeNull()
      expect(p.nombreEfectivo).toBe("TERMICA 2X16")
    })

    it("precio y stock no se pueden modificar desde el panel", async () => {
      await seedProducto(TENANT_A, "1", { stock: "7" })
      await producto.PATCH(
        req("/api/admin/catalogo/productos/1", {
          method: "PATCH",
          body: { nombre: "Nuevo", prices: [{ price: 1 }], stock: "999", alegraId: "otro" },
        }),
        params("1"),
      )
      const [fila] = await getDb()
        .select()
        .from(catalogProducts)
        .where(and(eq(catalogProducts.tenantId, TENANT_A), eq(catalogProducts.alegraId, "1")))
      expect(fila.stock).toBe("7")
      expect(fila.prices).toEqual(PRECIO)
    })
  })

  describe("acciones masivas", () => {
    it("por filtro afecta a TODO el conjunto y crea las filas de overlay que falten", async () => {
      for (const id of ["1", "2", "3"]) await seedProducto(TENANT_A, id)
      await seedProducto(TENANT_B, "9")
      await guardarOverlay(TENANT_A, "1", { visible: true })

      const res = await masiva.POST(
        req("/api/admin/catalogo/productos/masiva", {
          body: { seleccion: { tipo: "filtro", filtros: { foto: "sin" } }, accion: { tipo: "visible", valor: true } },
        }),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).afectados).toBe(3)

      const filas = await getDb().select().from(catalogOverlay).where(eq(catalogOverlay.tenantId, TENANT_A))
      expect(filas).toHaveLength(3)
      expect(filas.every((f) => f.visible)).toBe(true)
      // El producto del otro tenant no se tocó.
      const ajenas = await getDb().select().from(catalogOverlay).where(eq(catalogOverlay.tenantId, TENANT_B))
      expect(ajenas).toHaveLength(0)
    })

    it("`excluir` saca productos del conjunto del filtro", async () => {
      for (const id of ["1", "2", "3"]) await seedProducto(TENANT_A, id)

      const res = await masiva.POST(
        req("/api/admin/catalogo/productos/masiva", {
          body: {
            seleccion: { tipo: "filtro", filtros: {}, excluir: ["3"] },
            accion: { tipo: "visible", valor: true },
          },
        }),
      )
      expect((await res.json()).afectados).toBe(2)
    })

    it("ocultar dos veces es idempotente, no un error", async () => {
      await seedProducto(TENANT_A, "1")
      const cuerpo = { seleccion: { tipo: "ids", alegraIds: ["1"] }, accion: { tipo: "visible", valor: false } }
      expect((await masiva.POST(req("/api/admin/catalogo/productos/masiva", { body: cuerpo }))).status).toBe(200)
      expect((await masiva.POST(req("/api/admin/catalogo/productos/masiva", { body: cuerpo }))).status).toBe(200)
    })

    it("el conteo para la confirmación lo devuelve el servidor", async () => {
      for (const id of ["1", "2", "3", "4"]) await seedProducto(TENANT_A, id)
      await guardarOverlay(TENANT_A, "1", { fotos: [{ key: "a.webp", w: 800 }] })

      const res = await contar.POST(
        req("/api/admin/catalogo/productos/masiva/contar", { body: { seleccion: { tipo: "filtro", filtros: { foto: "sin" } } } }),
      )
      expect((await res.json()).afectados).toBe(3)
    })

    it("una acción inválida se rechaza sin escribir nada", async () => {
      await seedProducto(TENANT_A, "1")
      const res = await masiva.POST(
        req("/api/admin/catalogo/productos/masiva", {
          body: { seleccion: { tipo: "ids", alegraIds: ["1"] }, accion: { tipo: "precio", valor: 10 } },
        }),
      )
      expect(res.status).toBe(400)
      expect(await getDb().select().from(catalogOverlay)).toHaveLength(0)
    })
  })
})

async function updatedAt(alegraId: string): Promise<Date> {
  const [row] = await getDb()
    .select({ updatedAt: catalogOverlay.updatedAt })
    .from(catalogOverlay)
    .where(and(eq(catalogOverlay.tenantId, TENANT_A), eq(catalogOverlay.alegraId, alegraId)))
  return row.updatedAt
}
