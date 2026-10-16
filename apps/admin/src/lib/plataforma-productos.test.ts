import { describe, it, expect, vi } from "vitest"

const estado = vi.hoisted(() => ({
  cursor: { at: new Date(0), clave: "" } as { at: Date; clave: string },
  filas: [] as unknown[],
  upserts: [] as unknown[],
  falla: null as null | "red",
}))
vi.mock("@/lib/plataforma-proyeccion-repo", () => ({
  leerCursorProductos: async () => estado.cursor,
  guardarCursorProductos: async (_t: string, c: { at: Date; clave: string }) => { estado.cursor = c },
}))
vi.mock("@/lib/plataforma-cliente", async (orig) => ({
  ...(await orig<typeof import("@/lib/plataforma-cliente")>()),
  upsertInstancia: async (_t: unknown, spec: string, clave: string, body: unknown) => {
    estado.upserts.push({ spec, clave, body })
    const { PlataformaError } = await orig<typeof import("@/lib/plataforma-cliente")>()
    if (clave === "malo") throw new PlataformaError(400, "invalid_data", ["/name must be string"])
    if (clave === "red" && estado.falla === "red") throw new PlataformaError(503, "unavailable", [], true)
    return { created: true, changed: true }
  },
}))
vi.mock("@/lib/plataforma-productos-fuente", () => ({ leerProductosDesde: async () => estado.filas }))

import { productoParaPlataforma, empujarProductos } from "./plataforma-productos"
import type { TenantConfig } from "./tenants"

const t = { id: "central-led", plataformaUrl: "https://plataforma.example", plataformaApiKey: "ak", plataformaWebhookSecret: "s" } as TenantConfig
const fila = (alegraId: string, syncedAt: string) => ({ alegraId, name: "L", code: "C1", description: null, brand: "Marca", categoryAlegraId: "9", status: "active", alegraStatus: "active", stock: "12.5", images: ["https://img.example/1.jpg"], syncedAt: new Date(syncedAt) })

describe("productoParaPlataforma", () => {
  it("manda sólo los campos de la spec producto, con stock numérico", () => {
    expect(productoParaPlataforma(fila("42", "2026-10-15T00:00:00Z") as never)).toEqual({ name: "L", code: "C1", description: null, brand: "Marca", category_alegra_id: "9", status: "active", alegra_status: "active", stock: 12.5, images: ["https://img.example/1.jpg"] })
  })
})

describe("empujarProductos", () => {
  it("PATCH por producto, cuenta los 400 sin cortar y avanza el cursor compuesto", async () => {
    estado.cursor = { at: new Date(0), clave: "" }; estado.upserts = []
    estado.filas = [fila("42", "2026-10-15T00:00:01Z"), fila("malo", "2026-10-15T00:00:02Z"), fila("43", "2026-10-15T00:00:03Z")]
    const r = await empujarProductos(t)
    expect(r).toMatchObject({ enviados: 2, fallidos: 1 })
    expect(r.cursor).toEqual({ at: new Date("2026-10-15T00:00:03.000Z"), clave: "43" })
    expect(estado.cursor).toEqual({ at: new Date("2026-10-15T00:00:03.000Z"), clave: "43" })
    expect(estado.upserts.map((u) => (u as { clave: string }).clave)).toEqual(["42", "malo", "43"])
    expect((estado.upserts[0] as { spec: string }).spec).toBe("producto")
  })

  it("un error de red corta el lote y el cursor queda en la última fila procesada", async () => {
    estado.cursor = { at: new Date(0), clave: "" }; estado.upserts = []; estado.falla = "red"
    estado.filas = [fila("42", "2026-10-15T00:00:01Z"), fila("red", "2026-10-15T00:00:02Z"), fila("43", "2026-10-15T00:00:03Z")]
    const r = await empujarProductos(t)
    expect(r).toMatchObject({ enviados: 1, fallidos: 0 })
    expect(r.cursor).toEqual({ at: new Date("2026-10-15T00:00:01.000Z"), clave: "42" })
    expect(r.cortado).toBe(true)
    expect(estado.upserts.map((u) => (u as { clave: string }).clave)).toEqual(["42", "red"])
    estado.falla = null
  })
})
