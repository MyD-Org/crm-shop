import { describe, it, expect, vi, beforeEach } from "vitest"

const estado = vi.hoisted(() => ({
  modo: "dual" as "off" | "dual" | "on",
  llamadas: [] as { spec: string; clave: string; body: unknown }[],
  // Respuestas por orden de llamada a upsertInstancia; sin entrada = ok.
  fallos: [] as ({ status: number; code: string } | null)[],
  fila: null as unknown,
  enVuelo: 0,
  maxEnVuelo: 0,
  deps: [] as unknown[],
}))
vi.mock("@/lib/tenants", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenants")>()),
  getTenantByIdFromDb: async (id: string) => ({ id, plataformaUrl: "https://plataforma.example", plataformaApiKey: "ak", plataformaWebhookSecret: "s", plataformaAtributos: estado.modo }),
}))
vi.mock("@/lib/plataforma-productos-fuente", () => ({ leerProducto: async () => estado.fila }))
vi.mock("@/lib/plataforma-productos", () => ({ productoParaPlataforma: (f: { alegraId: string }) => ({ id: f.alegraId }) }))
vi.mock("@/lib/plataforma-cliente", async (orig) => {
  const o = await orig<typeof import("@/lib/plataforma-cliente")>()
  return {
    ...o,
    upsertInstancia: async (_t: unknown, spec: string, clave: string, body: unknown, deps?: unknown) => {
      estado.llamadas.push({ spec, clave, body })
      estado.deps.push(deps)
      estado.enVuelo++
      estado.maxEnVuelo = Math.max(estado.maxEnVuelo, estado.enVuelo)
      await new Promise((r) => setTimeout(r, 2))
      estado.enVuelo--
      const f = estado.fallos.shift()
      if (f) throw new o.PlataformaError(f.status, f.code, ["x"], f.status >= 500)
      return { created: false, changed: true }
    },
  }
})

import { TIMEOUT_ESCRITURA_MS, datosDeFilas, escribirAtributosPlataforma, escribirFilasPlataforma, escribirProductosPlataforma, modoAtributosDe } from "./plataforma-atributos"
import type { TenantConfig } from "./tenants"

const t = { id: "central-led", plataformaUrl: "https://plataforma.example", plataformaApiKey: "ak", plataformaWebhookSecret: "s", plataformaAtributos: "dual" } as TenantConfig

beforeEach(() => { estado.llamadas = []; estado.fallos = []; estado.fila = null; estado.enVuelo = 0; estado.maxEnVuelo = 0; estado.deps = [] })

describe("datosDeFilas", () => {
  it("arma {clave: {n, t}} a partir de las filas del CRM", () => {
    expect(datosDeFilas([{ alegraId: "42", clave: "potencia_w", valorNum: 20, valorTexto: null }, { alegraId: "42", clave: "tension_v", valorNum: 220, valorTexto: "85-265" }] as never))
      .toEqual({ potencia_w: { n: 20, t: null }, tension_v: { n: 220, t: "85-265" } })
  })
})

describe("escribirAtributosPlataforma", () => {
  it("PATCH a atributos_tecnicos con meta.fuente y reemplaza_fuente", async () => {
    expect(await escribirAtributosPlataforma(t, "42", { ip: { n: 65, t: null } }, "nombre", { reemplaza: true })).toBe("ok")
    expect(estado.llamadas[0]).toEqual({ spec: "atributos_tecnicos", clave: "42", body: { data: { ip: { n: 65, t: null } }, meta: { fuente: "nombre", reemplaza_fuente: true } } })
  })
  it("un 400 devuelve 'rechazado' sin tirar; un 503 devuelve 'error'", async () => {
    estado.fallos = [{ status: 400, code: "invalid_data" }]
    expect(await escribirAtributosPlataforma(t, "42", { ip: { n: 999, t: null } }, "pdf")).toBe("rechazado")
    estado.fallos = [{ status: 503, code: "interceptor_failed" }]
    expect(await escribirAtributosPlataforma(t, "42", { ip: { n: 1, t: null } }, "pdf")).toBe("error")
  })
  it("modoAtributosDe respeta la columna", async () => {
    estado.modo = "on"
    expect(await modoAtributosDe("central-led")).toBe("on")
    estado.modo = "dual"
  })
  it("404 anchor_not_found: sube el producto (spec producto) y reintenta una vez -> ok", async () => {
    estado.fallos = [{ status: 404, code: "anchor_not_found" }]
    estado.fila = { alegraId: "42" }
    expect(await escribirAtributosPlataforma(t, "42", { ip: { n: 65, t: null } }, "nombre")).toBe("ok")
    expect(estado.llamadas.map((l) => l.spec)).toEqual(["atributos_tecnicos", "producto", "atributos_tecnicos"])
  })
  it("404 anchor_not_found sin fila local -> rechazado, sin reintento", async () => {
    estado.fallos = [{ status: 404, code: "anchor_not_found" }]
    expect(await escribirAtributosPlataforma(t, "42", { ip: { n: 65, t: null } }, "nombre")).toBe("rechazado")
    expect(estado.llamadas).toHaveLength(1)
  })
  it("si el reintento también falla (503) -> error", async () => {
    estado.fallos = [{ status: 404, code: "anchor_not_found" }, null, { status: 503, code: "x" }]
    estado.fila = { alegraId: "42" }
    expect(await escribirAtributosPlataforma(t, "42", { ip: { n: 65, t: null } }, "nombre")).toBe("error")
    expect(estado.llamadas).toHaveLength(3)
  })
})

describe("escribirFilasPlataforma", () => {
  it("corre con concurrencia acotada a 8 y cuenta resultados", async () => {
    const filas = Array.from({ length: 30 }, (_, i) => ({ alegraId: String(i), clave: "potencia_w", valorNum: 1, valorTexto: null })) as never
    const r = await escribirFilasPlataforma(t, filas, "nombre")
    expect(r).toEqual({ ok: 30, rechazados: 0, errores: 0, filasOk: 30 })
    expect(estado.maxEnVuelo).toBeGreaterThan(1)
    expect(estado.maxEnVuelo).toBeLessThanOrEqual(8)
  })
  it("un 400 en el producto del medio se cuenta como rechazado y los otros dos siguen", async () => {
    estado.fallos = [null, { status: 400, code: "invalid_data" }, null]
    const filas = ["1", "2", "3"].map((alegraId) => ({ alegraId, clave: "ip", valorNum: 65, valorTexto: null })) as never
    // 1 sola en vuelo por orden de arranque: los fallos se consumen en orden de llamada
    const r = await escribirFilasPlataforma(t, filas, "nombre")
    expect(r.rechazados).toBe(1)
    expect(r.ok).toBe(2)
    expect(estado.llamadas).toHaveLength(3)
  })
  it("escribirProductosPlataforma: un 400 no corta a los demás", async () => {
    estado.fallos = [null, { status: 400, code: "invalid_data" }, null]
    const items = ["1", "2", "3"].map((alegraId) => ({ alegraId, data: { ip: { n: 65, t: null } } }))
    const r = await escribirProductosPlataforma(t, items, "nombre", { reemplaza: true })
    expect(r.ok).toBe(2)
    expect(estado.llamadas).toHaveLength(3)
  })
  it("tras el primer 503 no se lanzan más escrituras: los omitidos cuentan como errores", async () => {
    estado.fallos = [{ status: 503, code: "unavailable" }]
    const filas = Array.from({ length: 20 }, (_, i) => ({ alegraId: String(i), clave: "ip", valorNum: 65, valorTexto: null })) as never
    const r = await escribirFilasPlataforma(t, filas, "nombre")
    expect(estado.llamadas.length).toBeLessThanOrEqual(8)
    expect(r.ok + r.rechazados + r.errores).toBe(20)
    expect(r.errores).toBeGreaterThanOrEqual(13)
  })
  it("escribirProductosPlataforma: mismo corte tras un 503 y devuelve errores", async () => {
    estado.fallos = [{ status: 503, code: "unavailable" }]
    const items = Array.from({ length: 20 }, (_, i) => ({ alegraId: String(i), data: { ip: { n: 65, t: null } } }))
    const r = await escribirProductosPlataforma(t, items, "nombre")
    expect(estado.llamadas.length).toBeLessThanOrEqual(8)
    expect(r.ok + r.errores).toBe(20)
    expect(r.errores).toBeGreaterThanOrEqual(13)
  })
  it("un 400 (no reintentable) no corta: se escriben todos", async () => {
    estado.fallos = [{ status: 400, code: "invalid_data" }]
    const filas = Array.from({ length: 20 }, (_, i) => ({ alegraId: String(i), clave: "ip", valorNum: 65, valorTexto: null })) as never
    const r = await escribirFilasPlataforma(t, filas, "nombre")
    expect(estado.llamadas).toHaveLength(20)
    expect(r.rechazados).toBe(1)
  })
})

describe("timeout de escritura", () => {
  it("los escritores pasan timeoutMs=5000 (también el ancla y el reintento) y respetan uno explícito", async () => {
    expect(TIMEOUT_ESCRITURA_MS).toBe(5_000)
    estado.fallos = [{ status: 404, code: "anchor_not_found" }]
    estado.fila = { alegraId: "42" }
    await escribirAtributosPlataforma(t, "42", { ip: { n: 1, t: null } }, "nombre")
    expect(estado.deps).toHaveLength(3)
    for (const d of estado.deps) expect((d as { timeoutMs: number }).timeoutMs).toBe(5_000)
    estado.deps = []
    await escribirAtributosPlataforma(t, "42", { ip: { n: 1, t: null } }, "nombre", { deps: { timeoutMs: 1234 } })
    expect((estado.deps[0] as { timeoutMs: number }).timeoutMs).toBe(1234)
  })
})
