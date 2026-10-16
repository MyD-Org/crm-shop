import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { NextRequest } from "next/server"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogProducts, tenants } from "@/db/schema"
import { upsertProyeccion } from "@/lib/plataforma-proyeccion-repo"
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
// Plataforma simulada (sólo la usa el modo `on`): `fallo` hace tirar el PATCH; si no, responde con
// `instancia` (null = la respuesta no la trae). `bodies` guarda lo enviado.
const plataforma = vi.hoisted(() => ({
  fallo: null as null | "400" | "red",
  instancia: null as null | { data: Record<string, unknown>; updatedAt?: string },
  bodies: [] as unknown[],
}))
vi.mock("@/lib/plataforma-cliente", async (orig) => {
  const o = await orig<typeof import("@/lib/plataforma-cliente")>()
  return {
    ...o,
    upsertInstancia: async (_t: unknown, _spec: string, _clave: string, body: unknown) => {
      plataforma.bodies.push(body)
      if (plataforma.fallo === "400") throw new o.PlataformaError(400, "invalid_data", ["/ip/n must be <= 69"], false)
      if (plataforma.fallo === "red") throw new o.PlataformaError(0, "red", ["fetch failed"], true)
      return { created: false, changed: true, instance: plataforma.instancia }
    },
  }
})
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
  plataforma.fallo = null
  plataforma.instancia = null
  plataforma.bodies = []
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

describe("panel manual con el tenant en modo on (corte 0091)", () => {
  beforeEach(async () => {
    await getDb().update(tenants).set({ plataformaUrl: "https://plataforma.example", plataformaApiKey: "ak", plataformaWebhookSecret: "s", plataformaAtributos: "on" }).where(eq(tenants.id, A))
    await upsertProyeccion(A, "atributos_tecnicos", "100", "i100", { potencia_w: { n: 50, t: null }, fuentes: { potencia_w: "nombre" } }, new Date())
  })

  it("GET lee la proyección; PUT devuelve lo guardado sin esperar al webhook", async () => {
    let res = await rutaAtributos.GET(req("/x"), params("100"))
    expect((await res.json()).atributos).toMatchObject([{ clave: "potencia_w", valorNum: 50, fuente: "nombre" }])
    res = await rutaAtributos.PUT(req("/x", { method: "PUT", body: { valores: { ip: 65 } } }), params("100"))
    expect(res.status).toBe(200)
    expect((await res.json()).atributos).toMatchObject([
      { clave: "potencia_w", valorNum: 50, fuente: "nombre" },
      { clave: "ip", valorNum: 65, fuente: "manual" },
    ])
  })

  it("un rechazo de la plataforma → 422 con el motivo; una caída → 502 con el mensaje de reintento", async () => {
    plataforma.fallo = "400"
    let res = await rutaAtributos.PUT(req("/x", { method: "PUT", body: { valores: { ip: 68 } } }), params("100"))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: "La plataforma rechazó los valores: un valor está fuera de rango (ip)." })
    plataforma.fallo = "red"
    res = await rutaAtributos.PUT(req("/x", { method: "PUT", body: { valores: { ip: 65 } } }), params("100"))
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: "No se pudo guardar en la plataforma. Inténtelo de nuevo." })
  })
})

describe("leer ficha técnica con el tenant en modo on (corte 0091)", () => {
  beforeEach(async () => {
    await getDb().update(tenants).set({ plataformaUrl: "https://plataforma.example", plataformaApiKey: "ak", plataformaWebhookSecret: "s", plataformaAtributos: "on" }).where(eq(tenants.id, A))
    // Proyección previa: ip manual (protegida), potencia_w de nombre, tono ya leído de la ficha.
    await upsertProyeccion(A, "atributos_tecnicos", "100", "i100", {
      ip: { n: 66, t: null }, potencia_w: { n: 50, t: null }, tono: { n: null, t: "calido" },
      fuentes: { ip: "manual", potencia_w: "nombre", tono: "pdf" },
    }, new Date("2026-10-15T12:00:00Z"))
    await guardarOverlay(A, "100", { fichaTecnica: { key: KEY, nombre: "ficha.pdf", bytes: 4 } }, admin)
    fake.objects.set(KEY, { body: new Uint8Array([0x25, 0x50, 0x44, 0x46]), contentType: "application/pdf" })
    lector.leer.mockResolvedValue({
      atributos: [
        { clave: "potencia_w", valorNum: 48, valorTexto: null },
        { clave: "ip", valorNum: 65, valorTexto: null },
        { clave: "tono", valorNum: null, valorTexto: "calido" },
      ],
      uso: { entrada: 3000, salida: 100 },
    })
  })

  it("éxito: manda fuente pdf; la respuesta sale de la instancia y sinCambios cuenta lo protegido y lo que ya estaba igual", async () => {
    plataforma.instancia = {
      data: {
        ip: { n: 66, t: null }, potencia_w: { n: 48, t: null }, tono: { n: null, t: "calido" },
        fuentes: { ip: "manual", potencia_w: "pdf", tono: "pdf" },
      },
      updatedAt: "2026-10-15T13:00:00.000Z",
    }
    const res = await rutaLeer.POST(req("/x", { method: "POST" }), params("100"))
    expect(res.status).toBe(200)
    expect(plataforma.bodies).toEqual([{
      data: { potencia_w: { n: 48, t: null }, ip: { n: 65, t: null }, tono: { n: null, t: "calido" } },
      meta: { fuente: "pdf" },
    }])
    const body = await res.json()
    expect(body.leidos).toBe(3)
    expect(body.sinCambios).toBe(2) // ip (manual le gana) y tono (ya estaba igual de la ficha)
    expect(body.atributos).toMatchObject([
      { clave: "potencia_w", valorNum: 48, fuente: "pdf", updatedAt: "2026-10-15T13:00:00.000Z" },
      { clave: "tono", valorTexto: "calido", fuente: "pdf" },
      { clave: "ip", valorNum: 66, fuente: "manual" },
    ])
  })

  it("éxito sin instancia en la respuesta: lo leído sobre la proyección, sin pisar lo manual", async () => {
    const body = await (await rutaLeer.POST(req("/x", { method: "POST" }), params("100"))).json()
    expect(body.sinCambios).toBe(2)
    expect(body.atributos).toMatchObject([
      { clave: "potencia_w", valorNum: 48, fuente: "pdf" },
      { clave: "tono", valorTexto: "calido", fuente: "pdf" },
      { clave: "ip", valorNum: 66, fuente: "manual" },
    ])
  })

  it("un rechazo de la plataforma → 422 con el motivo legible; una caída → 502 (nada de 'sin cambios')", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    plataforma.fallo = "400"
    let res = await rutaLeer.POST(req("/x", { method: "POST" }), params("100"))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: "La plataforma rechazó los valores: un valor está fuera de rango (ip)." })
    plataforma.fallo = "red"
    res = await rutaLeer.POST(req("/x", { method: "POST" }), params("100"))
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: "No se pudo guardar en la plataforma. Inténtelo de nuevo." })
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
