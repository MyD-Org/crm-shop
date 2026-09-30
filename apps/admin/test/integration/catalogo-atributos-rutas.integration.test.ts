import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { NextRequest } from "next/server"
import { getDb } from "@/db"
import { catalogProducts } from "@/db/schema"
import { guardarOverlay } from "@/lib/catalogo-overlay-repo"
import { upsertAtributos } from "@/lib/catalogo-atributos-repo"
import { MAX_LECTURAS_POR_MINUTO, reiniciarGuardaLectura } from "@/lib/catalogo-atributos-lectura-guarda"
import { FakeR2 } from "./fake-r2"
import { seedOperator, seedTenant, truncateAll } from "./helpers"

// Rutas del panel de datos técnicos (catálogo asistido fase 2, subproyecto 5): GET/PUT
// .../atributos (panel manual) y POST .../atributos/leer-ficha (lector de PDF). DB real, guard
// real; R2 falso y el lector de Anthropic SIMULADO (nadie sale a la red).

let session: Record<string, unknown>
const r2 = vi.hoisted(() => ({ actual: null as unknown }))
const lector = vi.hoisted(() => ({ leer: vi.fn() }))

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
vi.mock("@/lib/catalogo-atributos-pdf", async (orig) => ({
  ...(await orig<typeof import("@/lib/catalogo-atributos-pdf")>()),
  leerFichaPdf: lector.leer,
}))

const rutaAtributos = await import("@/app/api/admin/catalogo/productos/[alegraId]/atributos/route")
const rutaLeer = await import("@/app/api/admin/catalogo/productos/[alegraId]/atributos/leer-ficha/route")

const A = "tenant-a"
const KEY = `productos/${A}/100/00000000-0000-4000-8000-000000000001.pdf`

const req = (path: string, init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(`http://${A}.localhost${path}`, {
    method: init.method ?? "GET",
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    headers: { host: `${A}.localhost` },
  })
const params = (alegraId: string) => ({ params: Promise.resolve({ alegraId }) })

function login(userId: string, role = "admin") {
  session = { userId, role, tenantId: A, name: "Ana", email: "ana@example.com", save: async () => {} }
}

let admin: string
let operador: string
let fake: FakeR2

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
  admin = await seedOperator(A, { role: "admin", email: "a@example.com" })
  operador = await seedOperator(A, { role: "operator", email: "op@example.com" })
  login(admin)
  await getDb().insert(catalogProducts).values({ tenantId: A, alegraId: "100", name: "REFLECTOR LED 50W CALIDO", status: "active", prices: [] })
  fake = new FakeR2()
  r2.actual = fake
  lector.leer.mockReset()
  reiniciarGuardaLectura()
})
afterAll(async () => {
  await truncateAll()
})

describe("panel manual", () => {
  it("GET lista; PUT fija manual y quita; un operator no ve la ruta", async () => {
    await upsertAtributos(A, [{ alegraId: "100", clave: "potencia_w", valorNum: 50, valorTexto: null }], "nombre")
    let res = await rutaAtributos.GET(req("/x"), params("100"))
    expect(res.status).toBe(200)
    expect((await res.json()).atributos).toMatchObject([{ clave: "potencia_w", valorNum: 50, fuente: "nombre" }])

    res = await rutaAtributos.PUT(req("/x", { method: "PUT", body: { valores: { potencia_w: "45", ip: 65, tono: null } } }), params("100"))
    expect(res.status).toBe(200)
    expect((await res.json()).atributos).toMatchObject([
      { clave: "potencia_w", valorNum: 45, fuente: "manual" },
      { clave: "ip", valorNum: 65, fuente: "manual" },
    ])

    res = await rutaAtributos.PUT(req("/x", { method: "PUT", body: { valores: { potencia_w: "mucha" } } }), params("100"))
    expect(res.status).toBe(422)

    login(operador, "operator")
    expect((await rutaAtributos.GET(req("/x"), params("100"))).status).toBe(404)
  })
})

describe("leer ficha técnica", () => {
  it("sin ficha cargada → 409", async () => {
    const res = await rutaLeer.POST(req("/x", { method: "POST" }), params("100"))
    expect(res.status).toBe(409)
    expect(lector.leer).not.toHaveBeenCalled()
  })

  it("lee el PDF de R2, guarda fuente pdf y no pisa un valor manual", async () => {
    await guardarOverlay(A, "100", { fichaTecnica: { key: KEY, nombre: "ficha.pdf", bytes: 4 } }, admin)
    fake.objects.set(KEY, { body: new Uint8Array([0x25, 0x50, 0x44, 0x46]), contentType: "application/pdf" })
    await upsertAtributos(A, [{ alegraId: "100", clave: "ip", valorNum: 66, valorTexto: null }], "manual")
    lector.leer.mockResolvedValue({
      atributos: [
        { clave: "potencia_w", valorNum: 48, valorTexto: null },
        { clave: "ip", valorNum: 65, valorTexto: null },
      ],
      uso: { entrada: 3000, salida: 100 },
    })

    const res = await rutaLeer.POST(req("/x", { method: "POST" }), params("100"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.leidos).toBe(2)
    expect(body.sinCambios).toBe(1)
    expect(body.atributos).toMatchObject([
      { clave: "potencia_w", valorNum: 48, fuente: "pdf" },
      { clave: "ip", valorNum: 66, fuente: "manual" },
    ])
    expect(lector.leer.mock.calls[0][0]).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]))
  })

  it("el archivo no está en R2 → 404 sin llamar al lector", async () => {
    await guardarOverlay(A, "100", { fichaTecnica: { key: KEY, nombre: "ficha.pdf", bytes: 4 } }, admin)
    const res = await rutaLeer.POST(req("/x", { method: "POST" }), params("100"))
    expect(res.status).toBe(404)
    expect(lector.leer).not.toHaveBeenCalled()
  })

  it("doble clic: una segunda lectura del mismo producto en curso → 409 y una sola llamada al lector", async () => {
    await guardarOverlay(A, "100", { fichaTecnica: { key: KEY, nombre: "ficha.pdf", bytes: 4 } }, admin)
    fake.objects.set(KEY, { body: new Uint8Array([0x25]), contentType: "application/pdf" })
    let soltar: (v: unknown) => void = () => {}
    lector.leer.mockReturnValue(new Promise((r) => (soltar = r)))
    const primera = rutaLeer.POST(req("/x", { method: "POST" }), params("100"))
    await new Promise((r) => setTimeout(r, 50))
    const segunda = await rutaLeer.POST(req("/x", { method: "POST" }), params("100"))
    expect(segunda.status).toBe(409)
    soltar({ atributos: [], uso: { entrada: 1, salida: 1 } })
    expect((await primera).status).toBe(200)
    expect(lector.leer).toHaveBeenCalledTimes(1)
    // Terminada la primera, se puede volver a leer.
    lector.leer.mockResolvedValue({ atributos: [], uso: { entrada: 1, salida: 1 } })
    expect((await rutaLeer.POST(req("/x", { method: "POST" }), params("100"))).status).toBe(200)
  })

  it(`tope por tenant: la lectura ${MAX_LECTURAS_POR_MINUTO + 1} del minuto → 429 sin llamar al lector`, async () => {
    await guardarOverlay(A, "100", { fichaTecnica: { key: KEY, nombre: "ficha.pdf", bytes: 4 } }, admin)
    fake.objects.set(KEY, { body: new Uint8Array([0x25]), contentType: "application/pdf" })
    lector.leer.mockResolvedValue({ atributos: [], uso: { entrada: 1, salida: 1 } })
    for (let i = 0; i < MAX_LECTURAS_POR_MINUTO; i++) {
      expect((await rutaLeer.POST(req("/x", { method: "POST" }), params("100"))).status).toBe(200)
    }
    expect((await rutaLeer.POST(req("/x", { method: "POST" }), params("100"))).status).toBe(429)
    expect(lector.leer).toHaveBeenCalledTimes(MAX_LECTURAS_POR_MINUTO)
  })
})
