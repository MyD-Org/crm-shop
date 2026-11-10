import { describe, it, expect, beforeEach, vi } from "vitest"
import type { NextRequest } from "next/server"

// Respuesta citada desde el inbox: la ruta pasa el id citado a ai-api y traduce el rechazo
// de una cita inválida a un 400 (no a un 502 de "falló el envío").

const state = vi.hoisted(() => ({
  calls: [] as unknown[][],
  result: { ok: true, id: "msg-1" } as Record<string, unknown>,
}))

vi.mock("@/lib/admin-route-guard", () => ({
  requireOperatorPlus: async () => ({ ok: true, tenantId: "tenant-a", user: { id: "yo", role: "operator" } }),
}))

vi.mock("@/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ id: "tenant-a", aiTenantId: "ai-a", aiApiUrl: "http://ai.test" }]),
      }),
    }),
  }),
}))

vi.mock("@/lib/inbox-api", () => ({
  sendReply: async (...args: unknown[]) => {
    state.calls.push(args)
    return state.result
  },
}))

const { POST } = await import("./route")

function post(body: unknown) {
  const req = new Request("http://crm.test/api/admin/inbox/conv-1/reply", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }) as unknown as NextRequest
  return POST(req, { params: Promise.resolve({ id: "conv-1" }) })
}

describe("POST /api/admin/inbox/:id/reply — respuesta citada", () => {
  beforeEach(() => {
    state.calls = []
    state.result = { ok: true, id: "msg-1" }
  })

  it("pasa el id del mensaje citado a ai-api", async () => {
    const res = await post({ text: " Sí, lo tenemos. ", reply_to_message_id: "citado-1" })
    expect(res.status).toBe(200)
    expect(state.calls[0]).toEqual(["http://ai.test", "ai-a", "conv-1", "Sí, lo tenemos.", "citado-1"])
  })

  it("sin cita manda undefined", async () => {
    await post({ text: "hola" })
    expect(state.calls[0][4]).toBeUndefined()
  })

  it("cita inválida → 400 invalid_reply_to", async () => {
    state.result = { ok: false, error: "invalid_reply_to" }
    const res = await post({ text: "hola", reply_to_message_id: "ajeno" })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "invalid_reply_to" })
  })
})
