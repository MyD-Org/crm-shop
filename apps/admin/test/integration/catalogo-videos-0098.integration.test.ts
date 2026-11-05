import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { getDb } from "@/db"
import { catalogProducts } from "@/db/schema"
import { detalleProducto, guardarOverlay, leerOverlay } from "@/lib/catalogo-overlay-repo"
import { recalcularGrupos } from "@/lib/catalogo-variantes-repo"
import { TEST_DATABASE_URL, assertLocalTestDb } from "./db-url"
import { seedOperator, seedTenant, truncateAll } from "./helpers"

// Migración 0098 (videos de YouTube por producto): columna, default, persistencia por el repo,
// ruta PUT /videos (guard real, DB real) y GRANT de SELECT a `shop_app`. Datos inventados.

let session: Record<string, unknown>

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))
vi.mock("@/lib/aviso-shop", () => ({ avisarShop: vi.fn(async () => {}) }))

const ruta = await import("@/app/api/admin/catalogo/productos/[alegraId]/videos/route")

const MIGRACION_0098 = fileURLToPath(new URL("../../drizzle/0098_producto_videos.sql", import.meta.url))
const A = "tenant-a"
const B = "tenant-b"
const V1 = "dQw4w9WgXcQ"
const V2 = "aaaaaaaaaaa"
const V3 = "bbbbbbbbbbb"
const V4 = "ccccccccccc"

const put = (alegraId: string, body: unknown, query = "") =>
  ruta.PUT(
    new NextRequest(`http://${A}.localhost/x${query}`, {
      method: "PUT",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { host: `${A}.localhost` },
    }),
    { params: Promise.resolve({ alegraId }) },
  )

async function sembrarBase() {
  await sembrar("100")
}

async function sembrar(id: string, extra: Partial<typeof catalogProducts.$inferInsert> = {}, tenant = A) {
  await getDb().insert(catalogProducts).values({ tenantId: tenant, alegraId: id, name: `Producto ${id}`, status: "active", prices: [], ...extra })
}

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
  await seedTenant(B)
  const admin = await seedOperator(A, { role: "admin", email: "a@example.com" })
  session = { mfa: "ok", userId: admin, role: "admin", tenantId: A, name: "Ana", email: "ana@example.com", save: async () => {} }
})
afterAll(async () => {
  await truncateAll()
})

describe("repo: videos del overlay", () => {
  it("una fila previa o recién creada tiene videos = []", async () => {
    await sembrarBase()
    await guardarOverlay(A, "100", { visible: true })
    expect((await leerOverlay(A, "100"))?.videos).toEqual([])
    expect((await detalleProducto(A, "100"))?.videos).toEqual([])
  })

  it("guarda y devuelve los videos; guardar otro campo no los pisa", async () => {
    await sembrarBase()
    await guardarOverlay(A, "100", { videos: [{ id: V1 }, { id: V2 }] })
    await guardarOverlay(A, "100", { nombre: "Otro nombre" })
    expect((await detalleProducto(A, "100"))?.videos).toEqual([{ id: V1 }, { id: V2 }])
    await guardarOverlay(A, "100", { videos: [] })
    expect((await detalleProducto(A, "100"))?.videos).toEqual([])
  })

  it("la variante viaja con sus videos propios; el modelo con los suyos", async () => {
    await sembrar("M1", { tipo: "padre" })
    for (const [i, op] of ["Verde", "Rojo"].entries()) {
      await sembrar(`M1-${i + 1}`, {
        tipo: "variante",
        padreAlegraId: "M1",
        variante: [{ atributo: "Color", opcion: op }],
        name: `Cinta / ${op}`,
      } as never)
    }
    await recalcularGrupos(A)
    await guardarOverlay(A, "M1", { videos: [{ id: V1 }] })
    await guardarOverlay(A, "M1-1", { videos: [{ id: V2 }] })
    const modelo = await detalleProducto(A, "M1")
    expect(modelo?.videos).toEqual([{ id: V1 }])
    expect(modelo?.variantes.find((v) => v.alegraId === "M1-1")?.videos).toEqual([{ id: V2 }])
    expect(modelo?.variantes.find((v) => v.alegraId === "M1-2")?.videos).toEqual([])
  })
})

describe("PUT /api/admin/catalogo/productos/[alegraId]/videos", () => {
  it("guarda la lista y devuelve el producto", async () => {
    await sembrarBase()
    const res = await put("100", { videos: [{ id: V1 }] })
    expect(res.status).toBe(200)
    expect((await res.json()).producto.videos).toEqual([{ id: V1 }])
    expect((await leerOverlay(A, "100"))?.videos).toEqual([{ id: V1 }])
  })

  it("rechaza ids inválidos, duplicados, más de 3 y cuerpos que no son JSON (mensajes en usted)", async () => {
    await sembrarBase()
    const casos: [unknown, string][] = [
      [{ videos: [{ id: "corto" }] }, "Ingrese un enlace de YouTube."],
      [{ videos: [{ id: V1 }, { id: V1 }] }, "Ese video ya está cargado."],
      [{ videos: [{ id: V1 }, { id: V2 }, { id: V3 }, { id: V4 }] }, "Se admiten hasta 3 videos por producto."],
      [{ videos: "x" }, "Indique los videos del producto."],
      ["no es json", "El cuerpo del pedido no es JSON válido."],
    ]
    for (const [body, error] of casos) {
      const res = await put("100", body)
      expect(res.status, JSON.stringify(body)).toBe(422)
      expect((await res.json()).error).toBe(error)
    }
    expect((await leerOverlay(A, "100"))?.videos ?? []).toEqual([])
  })

  it("un producto inexistente o de otro tenant es 404; un operator no entra", async () => {
    await sembrar("200", {}, B)
    expect((await put("999", { videos: [] })).status).toBe(404)
    expect((await put("200", { videos: [{ id: V1 }] })).status).toBe(404)
    await sembrarBase()
    const op = await seedOperator(A, { role: "operator", email: "o@example.com" })
    session = { ...session, userId: op, role: "operator" }
    expect((await put("100", { videos: [{ id: V1 }] })).status).toBe(404)
  })

  it("una variante agrupada exige ?alcance=variante; con él escribe sólo en su overlay", async () => {
    await sembrar("M1", { tipo: "padre" })
    await sembrar("M1-1", { tipo: "variante", padreAlegraId: "M1", variante: [{ atributo: "Color", opcion: "Verde" }] } as never)
    await sembrar("M1-2", { tipo: "variante", padreAlegraId: "M1", variante: [{ atributo: "Color", opcion: "Rojo" }] } as never)
    await recalcularGrupos(A)
    expect((await put("M1-1", { videos: [{ id: V2 }] })).status).toBe(400)
    expect((await put("M1-1", { videos: [{ id: V2 }] }, "?alcance=variante")).status).toBe(200)
    expect((await put("M1-1", { videos: [] }, "?alcance=otro")).status).toBe(400)
    expect((await leerOverlay(A, "M1-1"))?.videos).toEqual([{ id: V2 }])
    expect((await leerOverlay(A, "M1"))?.videos ?? []).toEqual([])
  })
})

describe("0098: GRANT a shop_app", () => {
  let pg: postgres.Sql
  let rolCreadoAca = false

  async function comoShopApp(stmt: string): Promise<{ ok: true } | { ok: false; code: string }> {
    let r: { ok: true } | { ok: false; code: string } | null = null
    const ROLLBACK = new Error("rollback")
    try {
      await pg.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE shop_app")
        try {
          await tx.unsafe(stmt)
          r = { ok: true }
        } catch (e) {
          r = { ok: false, code: (e as { code?: string }).code ?? "?" }
        }
        throw ROLLBACK
      })
    } catch (e) {
      if (e !== ROLLBACK) throw e
    }
    if (!r) throw new Error("comoShopApp: sin resultado")
    return r
  }

  const bloque = () => {
    const partes = readFileSync(MIGRACION_0098, "utf8").split("--> statement-breakpoint")
    const b = partes[partes.length - 1]
    if (!/DO \$\$/.test(b)) throw new Error("0098: no encontré el bloque DO $$ de los GRANTs")
    return b
  }

  beforeAll(async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    pg = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })
    const existe = await pg`SELECT 1 FROM pg_roles WHERE rolname = 'shop_app'`
    if (existe.length === 0) {
      await pg.unsafe("CREATE ROLE shop_app NOLOGIN")
      rolCreadoAca = true
    }
    // Idempotente: es el bloque que se corre a mano si el rol se creó después de migrar.
    await pg.unsafe(bloque())
  })
  afterAll(async () => {
    if (!pg) return
    if (rolCreadoAca) {
      await pg.unsafe("DROP OWNED BY shop_app")
      await pg.unsafe("DROP ROLE shop_app")
    }
    await pg.end()
  })

  it("shop_app lee catalog_overlay.videos y no la escribe", async () => {
    expect(await comoShopApp(`SELECT "videos" FROM public.catalog_overlay`)).toEqual({ ok: true })
    expect(await comoShopApp(`UPDATE public.catalog_overlay SET "videos" = '[]'::jsonb`)).toEqual({ ok: false, code: "42501" })
  })

  it("la columna es jsonb NOT NULL con default '[]'", async () => {
    const [c] = await getDb().execute(
      sql`select data_type, is_nullable, column_default from information_schema.columns where table_name = 'catalog_overlay' and column_name = 'videos'`,
    )
    expect(c).toMatchObject({ data_type: "jsonb", is_nullable: "NO" })
    expect(String(c.column_default)).toContain("'[]'::jsonb")
  })
})
