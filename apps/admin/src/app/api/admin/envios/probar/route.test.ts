import { describe, it, expect, beforeEach, vi } from "vitest"
import casos from "@/lib/__fixtures__/envio-zona-casos.json"
import type { MetodoEnvio } from "@/lib/envio-zona"
import type { Geometria } from "@/lib/geo-poligono"

/**
 * /api/admin/envios/probar: la "Prueba de dirección" corre las mismas funciones que el Shop sobre un
 * método guardado (`metodoId`) o sobre el borrador que se está editando (`metodo`). Guard 401/403,
 * validación 400 y casos del fixture compartido.
 */

const geometrias = casos.geometrias as unknown as Record<string, Geometria>
const puntos = casos.puntos as Record<string, { lat: number; lon: number }>
const guardado: MetodoEnvio = {
  ...(casos.metodo as unknown as MetodoEnvio),
  zonas: casos.metodo.zonas.map((z) => ({
    ...z,
    geometria: z.geometria ? geometrias[z.geometria] : [],
    entradas: z.entradas as MetodoEnvio["zonas"][number]["entradas"],
  })),
  localidades: Object.values(casos.localidades) as never,
}

const state = vi.hoisted(() => ({
  guarded: { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "operator" } } as Record<string, unknown>,
  metodo: null as unknown,
  tenantsLeidos: [] as string[],
}))

vi.mock("@/lib/admin-session", () => ({ getGuardedAdminSession: async () => state.guarded }))
vi.mock("@/lib/metodos-envio-repo", () => ({
  leerMetodoPuro: async (tenant: string) => {
    state.tenantsLeidos.push(tenant)
    return state.metodo
  },
}))
vi.mock("@/lib/metodos-envio-localidades", () => ({ completarLocalidad: async () => ({ centro: null, bbox: null }) }))

const ID = "0b9f3a52-6f1c-4f5e-9d2a-1c2d3e4f5a6b"
const req = (body: unknown) =>
  new Request("http://admin.test/api/admin/envios/probar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  state.guarded = { ok: true, tenantId: "tenant-a", user: { id: "u1", name: "Ana", email: "ana@cliente.example", role: "operator" } }
  state.metodo = guardado
  state.tenantsLeidos = []
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("POST /api/admin/envios/probar", () => {
  it("sin sesión → 401; rol desconocido → 403", async () => {
    const { POST } = await import("@/app/api/admin/envios/probar/route")
    state.guarded = { ok: false, reason: "no-session" }
    expect((await POST(req({ modo: "direccion", metodoId: ID }))).status).toBe(401)
    state.guarded = { ok: true, tenantId: "t", user: { id: "u", name: "X", email: "x@cliente.example", role: "visitante" } }
    expect((await POST(req({ modo: "direccion", metodoId: ID }))).status).toBe(403)
  })

  it("dirección: zona, regla, precio y entrega con las funciones del Shop (método guardado, tenant del guard)", async () => {
    const { POST } = await import("@/app/api/admin/envios/probar/route")
    const res = await POST(req({ modo: "direccion", metodoId: ID, punto: { ...puntos.hueco, precision: "altura" } }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ aplica: true, zona: "Ampliada", regla: "poligono", precio: 6000 })
    expect(state.tenantsLeidos).toEqual(["tenant-a"])
  })

  it("dirección fuera de las zonas: costo a coordinar", async () => {
    const { POST } = await import("@/app/api/admin/envios/probar/route")
    const res = await POST(req({ modo: "direccion", metodoId: ID, punto: { ...puntos.afuera, precision: "altura" } }))
    expect(await res.json()).toEqual({ aplica: false, mensaje: "Sin zona: costo a coordinar." })
  })

  it("solo localidad: el estimado", async () => {
    const { POST } = await import("@/app/api/admin/envios/probar/route")
    const res = await POST(req({ modo: "localidad", metodoId: ID, georefId: casos.localidades.mixta.georefId }))
    expect(await res.json()).toMatchObject({ aplica: true, estimado: { tipo: "desde", precio: 3000 } })
  })

  it("prueba el borrador sin guardar", async () => {
    const { POST } = await import("@/app/api/admin/envios/probar/route")
    const res = await POST(
      req({
        modo: "direccion",
        metodo: {
          nombre: "Borrador",
          provincia: "Buenos Aires",
          diasOperativos: [1, 2, 3, 4, 5],
          horaCorte: "09:00",
          zonas: [{ nombre: "Nueva", precio: 1234, geometria: geometrias.costa }],
        },
        punto: { ...puntos.costa, precision: "altura" },
      }),
    )
    expect(await res.json()).toMatchObject({ aplica: true, zona: "Nueva", precio: 1234 })
    expect(state.tenantsLeidos).toEqual([])
  })

  it("método inexistente → 404", async () => {
    state.metodo = null
    const { POST } = await import("@/app/api/admin/envios/probar/route")
    expect((await POST(req({ modo: "direccion", metodoId: ID, punto: { ...puntos.centro, precision: "altura" } }))).status).toBe(404)
  })

  it("validaciones → 400 en usted", async () => {
    const { POST } = await import("@/app/api/admin/envios/probar/route")
    for (const body of [
      { modo: "otra", metodoId: ID },
      { modo: "direccion" },
      { modo: "direccion", metodoId: "no-uuid" },
      { modo: "direccion", metodoId: ID },
      { modo: "direccion", metodoId: ID, punto: { lat: "x", lon: 1 } },
      { modo: "direccion", metodoId: ID, punto: { lat: 10, lon: 10 } },
      { modo: "localidad", metodoId: ID },
      { modo: "direccion", metodo: { nombre: "" } },
    ]) {
      const res = await POST(req(body))
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect((await res.json()).error).toEqual(expect.any(String))
    }
  })
})
