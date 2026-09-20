import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest"
import { and, eq, sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { getDb } from "@/db"
import { catalogOverlay, catalogOverlayTags, shopCategories, shopTags } from "@/db/schema"
import { seedTenant, truncateAll } from "./helpers"
import { validarJsonSchema } from "../contracts/json-schema-lite"
import schemaTaxonomia from "../contracts/catalogo-overlay/v1/schema-taxonomia.json"
import schemaOverlay from "../contracts/catalogo-overlay/v1/schema-overlay.json"

// L4: los dos endpoints internos que el Shop lee (contrato catalogo-overlay/v1). DB real
// (crm_test). Lo que protegen, en orden de gravedad:
//
//   1. El keyset COMPUESTO (updatedAt, alegraId). Con 600 filas que comparten updated_at —una
//      masiva es UNA transacción y UN now()—, paginar con un cursor simple perdería filas o
//      las repetiría para siempre. Es el caso que justifica todo el diseño del cursor.
//   2. La credencial. Estos endpoints NO se abren con INTERNAL_SECRET, que es la de ai-api y
//      además abre /api/agent/* (facturas, saldos, contactos).
//   3. Aislamiento por tenant: operan ÚNICAMENTE sobre el tenant del parámetro.

const taxonomia = await import("@/app/api/internal/shop/taxonomia/route")
const overlay = await import("@/app/api/internal/shop/catalogo-overlay/route")

const TENANT_A = "tenant-a"
const TENANT_B = "tenant-b"
const SECRET = "shop-crm-test-secret"

const pedir = (ruta: string, query: string, auth: string | null = `Bearer ${SECRET}`) =>
  new NextRequest(`http://${TENANT_A}.localhost/api/internal/shop/${ruta}${query}`, {
    headers: { host: `${TENANT_A}.localhost`, ...(auth ? { authorization: auth } : {}) },
  })

const getTaxonomia = (query: string, auth?: string | null) =>
  taxonomia.GET(pedir("taxonomia", query, auth === undefined ? `Bearer ${SECRET}` : auth))
const getOverlay = (query: string, auth?: string | null) =>
  overlay.GET(pedir("catalogo-overlay", query, auth === undefined ? `Bearer ${SECRET}` : auth))

async function seedCategoria(tenantId: string, extra: Partial<typeof shopCategories.$inferInsert> = {}) {
  const [row] = await getDb()
    .insert(shopCategories)
    .values({ tenantId, nombre: "Iluminación", slug: "iluminacion", ...extra })
    .returning()
  return row
}

async function seedTag(tenantId: string, nombre: string, slug: string) {
  const [row] = await getDb().insert(shopTags).values({ tenantId, nombre, slug }).returning()
  return row
}

async function seedOverlay(tenantId: string, alegraId: string, extra: Partial<typeof catalogOverlay.$inferInsert> = {}) {
  const [row] = await getDb()
    .insert(catalogOverlay)
    .values({ tenantId, alegraId, ...extra })
    .returning()
  return row
}

describe("endpoints internos del catálogo comercial", () => {
  beforeEach(async () => {
    await truncateAll()
    await seedTenant(TENANT_A)
    await seedTenant(TENANT_B)
    vi.stubEnv("SHOP_CRM_SECRET", SECRET)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  afterAll(async () => {
    await truncateAll()
  })

  describe("auth y parámetros (los dos endpoints se comportan igual)", () => {
    it("401 sin secreto y con secreto incorrecto, sin filtrar datos de catálogo", async () => {
      await seedOverlay(TENANT_A, "12345", { nombre: "Lámpara colgante E27" })

      for (const get of [getTaxonomia, getOverlay]) {
        for (const auth of [null, "Bearer otro", "otro"]) {
          const res = await get(`?tenant=${TENANT_A}`, auth)
          expect(res.status).toBe(401)
          const cuerpo = JSON.stringify(await res.json())
          expect(cuerpo).toBe('{"error":"unauthorized"}')
          expect(cuerpo).not.toMatch(/Lámpara|12345/)
        }
      }
    })

    it("401 con INTERNAL_SECRET: la llave de ai-api NO abre los endpoints del Shop", async () => {
      vi.stubEnv("INTERNAL_SECRET", "llave-de-ai-api")
      expect((await getTaxonomia(`?tenant=${TENANT_A}`, "Bearer llave-de-ai-api")).status).toBe(401)
      expect((await getOverlay(`?tenant=${TENANT_A}`, "Bearer llave-de-ai-api")).status).toBe(401)
    })

    it("400 sin tenant y 404 tenant inexistente son distinguibles", async () => {
      expect((await getTaxonomia("")).status).toBe(400)
      expect((await getOverlay("")).status).toBe(400)
      expect((await getTaxonomia("?tenant=no-existe")).status).toBe(404)
      expect((await getOverlay("?tenant=no-existe")).status).toBe(404)
      // Se busca por tenants.id, no por aiTenantId.
      expect((await getTaxonomia(`?tenant=ai-${TENANT_A}`)).status).toBe(404)
    })

    it("nunca se cachean", async () => {
      expect((await getTaxonomia(`?tenant=${TENANT_A}`)).headers.get("cache-control")).toBe("no-store")
      expect((await getOverlay(`?tenant=${TENANT_A}`)).headers.get("cache-control")).toBe("no-store")
      expect((await getTaxonomia("?tenant=no-existe")).headers.get("cache-control")).toBe("no-store")
    })
  })

  describe("GET /api/internal/shop/taxonomia", () => {
    it("200 vacío válido: sin categorías ni tags NO es un fallo", async () => {
      const res = await getTaxonomia(`?tenant=${TENANT_A}`)
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(validarJsonSchema(schemaTaxonomia, json)).toEqual([])
      expect(json).toMatchObject({ version: "v1", tenant: TENANT_A, categorias: [], tags: [] })
    })

    it("árbol entero (incluidas las inactivas) + diccionario de tags, ordenado y sin mezclar tenants", async () => {
      const raiz = await seedCategoria(TENANT_A, { nombre: "Electricidad", slug: "electricidad", orden: 1 })
      await seedCategoria(TENANT_A, { nombre: "Iluminación", slug: "iluminacion", orden: 0 })
      await seedCategoria(TENANT_A, {
        nombre: "Térmicas",
        slug: "termicas",
        parentId: raiz.id,
        nivel: 2,
        activa: false,
      })
      await seedTag(TENANT_A, "Oferta", "oferta")
      await seedTag(TENANT_A, "Nuevo", "nuevo")

      await seedCategoria(TENANT_B, { nombre: "Ajena", slug: "ajena" })
      await seedTag(TENANT_B, "Ajeno", "ajeno")

      const json = await (await getTaxonomia(`?tenant=${TENANT_A}`)).json()
      expect(validarJsonSchema(schemaTaxonomia, json)).toEqual([])
      expect(json.categorias.map((c: { slug: string }) => c.slug)).toEqual(["iluminacion", "electricidad", "termicas"])
      // La inactiva viaja igual: el Shop necesita saber que existe.
      expect(json.categorias.at(-1)).toMatchObject({ activa: false, nivel: 2, parentId: raiz.id })
      expect(json.tags.map((t: { slug: string }) => t.slug)).toEqual(["nuevo", "oferta"])
    })

    it("el tenant B ve lo suyo y nada del A", async () => {
      await seedCategoria(TENANT_A, { nombre: "Solo A", slug: "solo-a" })
      await seedCategoria(TENANT_B, { nombre: "Solo B", slug: "solo-b" })
      const json = await (await getTaxonomia(`?tenant=${TENANT_B}`)).json()
      expect(json.tenant).toBe(TENANT_B)
      expect(json.categorias.map((c: { slug: string }) => c.slug)).toEqual(["solo-b"])
    })
  })

  describe("GET /api/internal/shop/catalogo-overlay", () => {
    it("400 por limit fuera de rango y por desde que no parsea", async () => {
      for (const q of ["limit=0", "limit=1001", "limit=abc"]) {
        const res = await getOverlay(`?tenant=${TENANT_A}&${q}`)
        expect(res.status).toBe(400)
        expect(await res.json()).toEqual({ error: "invalid limit" })
      }
      const res = await getOverlay(`?tenant=${TENANT_A}&desde=ayer`)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: "invalid desde" })
    })

    it("carga inicial: el overlay entero, con tagIds por uuid y las fotos ordenadas", async () => {
      const categoria = await seedCategoria(TENANT_A)
      const oferta = await seedTag(TENANT_A, "Oferta", "oferta")
      const nuevo = await seedTag(TENANT_A, "Nuevo", "nuevo")
      const fila = await seedOverlay(TENANT_A, "12345", {
        visible: true,
        nombre: "Lámpara colgante E27",
        categoriaId: categoria.id,
        orden: 0,
        fotos: [
          { url: "https://fotos.example/shop/tenant-a/12345/0123456789abcdef01234567-1600.webp", w: 1600, alt: "Frente" },
          { url: "https://fotos.example/shop/tenant-a/12345/0123456789abcdef01234567-800.webp", w: 800 },
        ],
      })
      await getDb()
        .insert(catalogOverlayTags)
        .values([
          { overlayId: fila.id, tagId: oferta.id },
          { overlayId: fila.id, tagId: nuevo.id },
        ])
      // Despublicado: viaja como visible:false, NO como borrado.
      await seedOverlay(TENANT_A, "9001", { visible: false, nombre: "   " })
      await seedOverlay(TENANT_B, "77777", { visible: true, nombre: "De otro tenant" })

      const json = await (await getOverlay(`?tenant=${TENANT_A}`)).json()
      expect(validarJsonSchema(schemaOverlay, json)).toEqual([])
      expect(json.items).toHaveLength(2)
      expect(json.hasMore).toBe(false)
      expect(json.nextCursor).toBeNull()

      const item = json.items.find((i: { alegraId: string }) => i.alegraId === "12345")
      expect(item).toMatchObject({ visible: true, nombre: "Lámpara colgante E27", categoriaId: categoria.id, orden: 0 })
      expect(item.tagIds.slice().sort()).toEqual([oferta.id, nuevo.id].sort())
      expect(item.fotos.map((f: { w: number }) => f.w)).toEqual([1600, 800])

      const oculto = json.items.find((i: { alegraId: string }) => i.alegraId === "9001")
      // Nombre vaciado ⇒ null (vuelve al default de Alegra), no cadena vacía.
      expect(oculto).toMatchObject({ visible: false, nombre: null, tagIds: [], fotos: [] })
    })

    it("delta: desde una marca sólo viaja lo modificado después", async () => {
      await seedOverlay(TENANT_A, "1000")
      await seedOverlay(TENANT_A, "1001")
      const primera = await (await getOverlay(`?tenant=${TENANT_A}`)).json()
      const ultimo = primera.items.at(-1)

      const vacio = await (
        await getOverlay(`?tenant=${TENANT_A}&desde=${encodeURIComponent(ultimo.updatedAt)}&cursor=${ultimo.alegraId}`)
      ).json()
      expect(vacio.items).toEqual([])

      await seedOverlay(TENANT_A, "1002", { visible: true })
      const delta = await (
        await getOverlay(`?tenant=${TENANT_A}&desde=${encodeURIComponent(ultimo.updatedAt)}&cursor=${ultimo.alegraId}`)
      ).json()
      expect(delta.items.map((i: { alegraId: string }) => i.alegraId)).toEqual(["1002"])
    })

    it("600 filas con el MISMO updated_at: paginar entero no pierde ni repite ninguna", async () => {
      // Una sola sentencia ⇒ una transacción ⇒ un now(): las 600 comparten updated_at, que es
      // exactamente lo que produce una acción masiva y lo que rompe un cursor simple.
      const valores = Array.from({ length: 600 }, (_, i) => ({
        tenantId: TENANT_A,
        alegraId: `p-${String(i).padStart(4, "0")}`,
      }))
      await getDb().insert(catalogOverlay).values(valores)

      const [{ distintos }] = (await getDb().execute(
        sql`SELECT count(DISTINCT updated_at)::int AS distintos FROM ${catalogOverlay} WHERE tenant_id = ${TENANT_A}`,
      )) as unknown as { distintos: number }[]
      expect(distintos).toBe(1)

      const vistos: string[] = []
      let query = `?tenant=${TENANT_A}&limit=137`
      for (let pagina = 0; pagina < 20; pagina++) {
        const json = await (await getOverlay(query)).json()
        expect(validarJsonSchema(schemaOverlay, json)).toEqual([])
        vistos.push(...json.items.map((i: { alegraId: string }) => i.alegraId))
        if (!json.hasMore) break
        expect(json.nextCursor).toEqual({
          desde: json.items.at(-1).updatedAt,
          cursor: json.items.at(-1).alegraId,
        })
        query = `?tenant=${TENANT_A}&limit=137&desde=${encodeURIComponent(json.nextCursor.desde)}&cursor=${json.nextCursor.cursor}`
      }

      expect(vistos).toHaveLength(600)
      expect(new Set(vistos).size).toBe(600)
      expect(vistos).toEqual([...vistos].sort())
    })

    it("hasMore es 'trajo exactamente limit', y el falso positivo es aceptable", async () => {
      await seedOverlay(TENANT_A, "1000")
      await seedOverlay(TENANT_A, "1001")

      const llena = await (await getOverlay(`?tenant=${TENANT_A}&limit=2`)).json()
      expect(llena.hasMore).toBe(true)
      expect(llena.nextCursor).not.toBeNull()

      // La página siguiente viene vacía: falso positivo documentado, no un error.
      const siguiente = await (
        await getOverlay(
          `?tenant=${TENANT_A}&limit=2&desde=${encodeURIComponent(llena.nextCursor.desde)}&cursor=${llena.nextCursor.cursor}`,
        )
      ).json()
      expect(siguiente.items).toEqual([])
      expect(siguiente.hasMore).toBe(false)
    })

    it("un overlay que apunta a una categoría borrada viaja con categoriaId null", async () => {
      const categoria = await seedCategoria(TENANT_A)
      await seedOverlay(TENANT_A, "12345", { visible: true, categoriaId: categoria.id })
      await getDb()
        .delete(shopCategories)
        .where(and(eq(shopCategories.id, categoria.id), eq(shopCategories.tenantId, TENANT_A)))

      const json = await (await getOverlay(`?tenant=${TENANT_A}`)).json()
      expect(validarJsonSchema(schemaOverlay, json)).toEqual([])
      expect(json.items[0].categoriaId).toBeNull()
    })
  })
})
