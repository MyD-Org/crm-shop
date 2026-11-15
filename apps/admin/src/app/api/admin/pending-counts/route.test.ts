import { describe, expect, it, vi } from "vitest"

// El rol «compras» no tiene secciones con contadores: la ruta responde ceros SIN tocar la DB,
// ai-api ni el correo (nada del tenant se calcula para él).
const llamadas = vi.hoisted(() => ({ db: 0, inbox: 0, correo: 0 }))

vi.mock("@/lib/admin-session", () => ({
  getGuardedAdminSession: async () => ({
    ok: true,
    tenantId: "t1",
    user: { id: "u1", name: "N", email: "n@cliente.example", role: "compras" },
  }),
}))
vi.mock("@/db", () => ({
  getDb: () => {
    llamadas.db++
    throw new Error("no debería consultar la DB")
  },
}))
vi.mock("@/lib/inbox-api", () => ({
  listConversations: async () => {
    llamadas.inbox++
    return []
  },
}))
vi.mock("@/lib/correo-flag", () => ({
  correoHabilitado: async () => {
    llamadas.correo++
    return true
  },
}))

import { GET } from "./route"

describe("GET /api/admin/pending-counts con el rol «compras»", () => {
  it("responde ceros y no consulta nada del tenant", async () => {
    const res = await GET(new Request("http://localhost/api/admin/pending-counts"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ inbox: 0, comprobantes: null, pedidos: null, correo: 0 })
    expect(llamadas).toEqual({ db: 0, inbox: 0, correo: 0 })
  })
})
