import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { NextRequest } from "next/server"
import { getDb } from "@/db"
import { catalogProducts } from "@/db/schema"
import { sha256Hex } from "@/lib/catalogo-ficha-contenido"
import { cambiarFichaSiVigente, contarReferenciasFicha, leerFichaDeProducto } from "@/lib/catalogo-ficha-repo"
import { guardarOverlay } from "@/lib/catalogo-overlay-repo"
import { fichaContenidoKey } from "@/lib/shop-media"
import { FakeR2 } from "./fake-r2"
import { seedTenant, seedOperator, truncateAll } from "./helpers"

// Fichas técnicas POR CONTENIDO: subida sin re-subir, y borrado seguro cuando varios productos
// comparten el mismo objeto de R2. DB real, guard real, R2 falso.

let session: Record<string, unknown>
const r2 = vi.hoisted(() => ({ actual: null as unknown }))

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))
vi.mock("@/lib/aviso-shop", () => ({ avisarShop: vi.fn(async () => {}) }))
vi.mock("@/lib/shop-media", async (orig) => ({
  ...(await orig<typeof import("@/lib/shop-media")>()),
  getShopMediaR2: () => r2.actual,
}))

const ruta = await import("@/app/api/admin/catalogo/productos/[alegraId]/ficha/route")

const A = "tenant-a"
const PDF = new TextEncoder().encode("%PDF-1.4 ficha ficticia")
const SHA = sha256Hex(PDF)
const KEY = fichaContenidoKey(A, SHA)
const PDF2 = new TextEncoder().encode("%PDF-1.4 otra ficha ficticia")
const KEY2 = fichaContenidoKey(A, sha256Hex(PDF2))

const req = (method: string, body?: unknown) =>
  new NextRequest(`http://${A}.localhost/x`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { host: `${A}.localhost` },
  })
const params = (alegraId: string) => ({ params: Promise.resolve({ alegraId }) })

let fake: FakeR2
let admin: string

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
  admin = await seedOperator(A, { role: "admin", email: "a@example.com" })
  session = { userId: admin, role: "admin", tenantId: A, name: "Ana", email: "ana@example.com", save: async () => {} }
  const db = getDb()
  for (const id of ["100", "200", "300"]) {
    await db.insert(catalogProducts).values({ tenantId: A, alegraId: id, name: `PRODUCTO ${id}`, status: "active", prices: [] })
  }
  fake = new FakeR2()
  r2.actual = fake
})
afterAll(async () => {
  await truncateAll()
})

describe("POST: firma por contenido", () => {
  it("con sha256 y el objeto ausente: key por contenido y URL de subida", async () => {
    const res = await ruta.POST(req("POST", { nombre: "f.pdf", bytes: PDF.length, sha256: SHA }), params("100"))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ key: KEY, existente: false, url: expect.any(String) })
  })

  it("con el objeto ya en el bucket: existente, sin URL (no se vuelve a subir)", async () => {
    fake.objects.set(KEY, { body: PDF, contentType: "application/pdf" })
    const res = await ruta.POST(req("POST", { nombre: "f.pdf", bytes: PDF.length, sha256: SHA }), params("200"))
    const json = await res.json()
    expect(json).toMatchObject({ key: KEY, existente: true, bytes: PDF.length })
    expect(json.url).toBeUndefined()
    expect(fake.calls.presignPut).toBe(0)
  })

  it("sha256 mal formado → 422", async () => {
    const res = await ruta.POST(req("POST", { nombre: "f.pdf", bytes: 5, sha256: "xyz" }), params("100"))
    expect(res.status).toBe(422)
  })

  it("sin sha256 (cliente viejo): key propia del producto, como antes", async () => {
    const res = await ruta.POST(req("POST", { nombre: "f.pdf", bytes: 5 }), params("100"))
    expect((await res.json()).key).toMatch(new RegExp(`^productos/${A}/100/ficha-`))
  })
})

describe("PUT: guarda la referencia", () => {
  it("guarda key, sha256 y el tamaño REAL del objeto", async () => {
    fake.objects.set(KEY, { body: PDF, contentType: "application/pdf" })
    const res = await ruta.PUT(req("PUT", { key: KEY, nombre: "f.pdf", bytes: 999 }), params("100"))
    expect(res.status).toBe(200)
    expect(await leerFichaDeProducto(A, "100")).toEqual({ key: KEY, nombre: "f.pdf", bytes: PDF.length, sha256: SHA })
  })

  it("rechaza una key por contenido cuyo archivo no es el del sha256", async () => {
    fake.objects.set(KEY, { body: PDF2, contentType: "application/pdf" })
    const res = await ruta.PUT(req("PUT", { key: KEY, nombre: "f.pdf", bytes: 5 }), params("100"))
    expect(res.status).toBe(422)
    expect(await leerFichaDeProducto(A, "100")).toBeNull()
    expect(fake.objects.has(KEY)).toBe(false) // nadie lo usa: se limpia
  })

  it("rechaza una key por contenido de OTRO tenant", async () => {
    const ajena = fichaContenidoKey("tenant-b", SHA)
    fake.objects.set(ajena, { body: PDF, contentType: "application/pdf" })
    const res = await ruta.PUT(req("PUT", { key: ajena, nombre: "f.pdf", bytes: 5 }), params("100"))
    expect(res.status).toBe(422)
  })

  it("objeto que no llegó al bucket → 409", async () => {
    const res = await ruta.PUT(req("PUT", { key: KEY, nombre: "f.pdf", bytes: 5 }), params("100"))
    expect(res.status).toBe(409)
  })

  it("sigue aceptando la key propia del producto (cliente viejo)", async () => {
    const propia = `productos/${A}/100/ficha-00000000-0000-4000-8000-000000000001.pdf`
    const res = await ruta.PUT(req("PUT", { key: propia, nombre: "f.pdf", bytes: 5 }), params("100"))
    expect(res.status).toBe(200)
  })
})

describe("borrado seguro", () => {
  async function compartir() {
    fake.objects.set(KEY, { body: PDF, contentType: "application/pdf" })
    for (const id of ["100", "200"]) {
      await guardarOverlay(A, id, { fichaTecnica: { key: KEY, nombre: `${id}.pdf`, bytes: PDF.length, sha256: SHA } }, admin)
    }
  }

  it("DELETE de un producto NO borra el objeto si otro lo sigue usando", async () => {
    await compartir()
    const res = await ruta.DELETE(req("DELETE"), params("100"))
    expect(res.status).toBe(200)
    expect(await leerFichaDeProducto(A, "100")).toBeNull()
    expect(fake.objects.has(KEY)).toBe(true)
    expect(fake.calls.delete).toBe(0)
  })

  it("DELETE del último producto que lo usa sí borra el objeto", async () => {
    await compartir()
    await ruta.DELETE(req("DELETE"), params("100"))
    await ruta.DELETE(req("DELETE"), params("200"))
    expect(fake.objects.has(KEY)).toBe(false)
  })

  it("PUT que reemplaza la ficha NO borra el objeto anterior si otro lo usa", async () => {
    await compartir()
    fake.objects.set(KEY2, { body: PDF2, contentType: "application/pdf" })
    const res = await ruta.PUT(req("PUT", { key: KEY2, nombre: "nueva.pdf", bytes: PDF2.length }), params("100"))
    expect(res.status).toBe(200)
    expect(fake.objects.has(KEY)).toBe(true)
    expect((await leerFichaDeProducto(A, "100"))?.key).toBe(KEY2)
  })

  it("PUT que reemplaza la ficha SÍ borra el objeto anterior si era sólo de ese producto", async () => {
    fake.objects.set(KEY, { body: PDF, contentType: "application/pdf" })
    await guardarOverlay(A, "100", { fichaTecnica: { key: KEY, nombre: "a.pdf", bytes: PDF.length, sha256: SHA } }, admin)
    fake.objects.set(KEY2, { body: PDF2, contentType: "application/pdf" })
    await ruta.PUT(req("PUT", { key: KEY2, nombre: "nueva.pdf", bytes: PDF2.length }), params("100"))
    expect(fake.objects.has(KEY)).toBe(false)
    expect(fake.objects.has(KEY2)).toBe(true)
  })

  it("el respaldo (origen) se borra también cuando nadie lo referencia", async () => {
    const origen = `productos/${A}/100/ficha-00000000-0000-4000-8000-000000000009.pdf`
    fake.objects.set(origen, { body: PDF, contentType: "application/pdf" })
    fake.objects.set(KEY, { body: PDF, contentType: "application/pdf" })
    await guardarOverlay(
      A,
      "100",
      { fichaTecnica: { key: KEY, nombre: "a.pdf", bytes: PDF.length, sha256: SHA, origen: { key: origen, bytes: PDF.length } } },
      admin,
    )
    await ruta.DELETE(req("DELETE"), params("100"))
    expect(fake.objects.has(origen)).toBe(false)
    expect(fake.objects.has(KEY)).toBe(false)
  })

  it("un respaldo que otro producto usa como origen NO se borra", async () => {
    const origen = `productos/${A}/100/ficha-00000000-0000-4000-8000-000000000009.pdf`
    fake.objects.set(origen, { body: PDF, contentType: "application/pdf" })
    for (const id of ["100", "200"]) {
      await guardarOverlay(A, id, { fichaTecnica: { key: KEY, nombre: "a.pdf", bytes: 1, origen: { key: origen, bytes: 1 } } }, admin)
    }
    await ruta.DELETE(req("DELETE"), params("100"))
    expect(fake.objects.has(origen)).toBe(true)
  })
})

describe("repo: contar referencias y compare-and-swap", () => {
  it("cuenta las referencias por ficha y por origen, sólo del tenant", async () => {
    await guardarOverlay(A, "100", { fichaTecnica: { key: KEY, nombre: "a", bytes: 1 } }, admin)
    await guardarOverlay(A, "200", { fichaTecnica: { key: "x", nombre: "b", bytes: 1, origen: { key: KEY, bytes: 1 } } }, admin)
    expect(await contarReferenciasFicha(A, KEY)).toBe(2)
    expect(await contarReferenciasFicha("otro", KEY)).toBe(0)
  })

  it("cambiarFichaSiVigente sólo cambia si la key vigente coincide", async () => {
    await guardarOverlay(A, "100", { fichaTecnica: { key: "vieja", nombre: "a", bytes: 1 } }, admin)
    const nueva = { key: KEY, nombre: "a", bytes: 1, sha256: SHA, origen: { key: "vieja", bytes: 1 } }
    expect(await cambiarFichaSiVigente(A, "100", "otra", nueva, "script:test")).toBe(false)
    expect((await leerFichaDeProducto(A, "100"))?.key).toBe("vieja")
    expect(await cambiarFichaSiVigente(A, "100", "vieja", nueva, "script:test")).toBe(true)
    expect(await leerFichaDeProducto(A, "100")).toEqual(nueva)
  })
})
