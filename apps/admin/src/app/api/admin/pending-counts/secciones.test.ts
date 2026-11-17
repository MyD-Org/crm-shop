import { beforeEach, describe, expect, it, vi } from "vitest"

// pending-counts filtrado por sección (permisos-por-seccion): cada contador sale sólo si el usuario
// ve su sección; con las columnas NULL, igual que antes (operador: pedidos/comprobantes en null).
const estado = vi.hoisted(() => ({
  user: { id: "u1", name: "N", email: "n@cliente.example", role: "operator" } as Record<string, unknown>,
  correo: false,
}))

vi.mock("@/lib/admin-session", () => ({
  getGuardedAdminSession: async () => ({ ok: true, tenantId: "t1", user: estado.user }),
}))
vi.mock("@/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({ where: async () => [{ id: "t1", aiApiUrl: "https://ai.plataforma.example", aiTenantId: "ai-t1" }] }),
    }),
  }),
}))
vi.mock("@/lib/inbox-api", () => ({
  listConversations: async () => [
    { awaiting_reply: true, status: "active", last_inbound_at: null },
    { awaiting_reply: true, status: "active", last_inbound_at: null },
  ],
}))
vi.mock("@/lib/payment-receipts", () => ({ listPendingSubmittedAt: async () => [new Date()] }))
vi.mock("@/lib/pedidos-repo", () => ({ listPendientesCreatedAt: async () => [new Date(), new Date(), new Date()] }))
vi.mock("@/lib/correo-flag", () => ({ correoHabilitado: async () => estado.correo }))
vi.mock("@/lib/correo-acceso", () => ({ casillasAccesibles: async () => [{ id: "c1" }] }))
vi.mock("@/lib/correo-repo", () => ({ contarNoLeidos: async () => 4 }))

import { GET, clearPendingCountsCache } from "./route"

async function contadores(user: Record<string, unknown>, correo = false) {
  estado.user = { id: "u1", name: "N", email: "n@cliente.example", ...user }
  estado.correo = correo
  const res = await GET(new Request("http://localhost/api/admin/pending-counts"))
  expect(res.status).toBe(200)
  return res.json()
}

beforeEach(() => clearPendingCountsCache())

describe("GET /api/admin/pending-counts por sección", () => {
  it("columnas NULL: operador sin pedidos/comprobantes, admin con todo (como antes)", async () => {
    expect(await contadores({ role: "operator" })).toEqual({ inbox: 2, comprobantes: null, pedidos: null, correo: 0 })
    expect(await contadores({ role: "admin" })).toEqual({ inbox: 2, comprobantes: 1, pedidos: 3, correo: 0 })
  })

  it("usuario con sólo `inbox`: no recibe contadores de pedidos ni de comprobantes", async () => {
    expect(await contadores({ role: "admin", seccionesPermitidas: ["inbox"] })).toEqual({ inbox: 2, comprobantes: null, pedidos: null, correo: 0 })
  })

  it("operador con `pedidos` recibe el de pedidos; sin `inbox` no recibe mensajes ni correo", async () => {
    expect(await contadores({ role: "operator", seccionesPermitidas: ["pedidos"] }, true)).toEqual({ inbox: 0, comprobantes: null, pedidos: 3, correo: 0 })
  })

  it("el correo sólo cuenta con la sección Mensajes", async () => {
    expect(await contadores({ role: "operator" }, true)).toMatchObject({ correo: 4 })
  })
})
