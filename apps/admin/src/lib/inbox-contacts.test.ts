import { describe, expect, it, vi } from "vitest"

const contactos = vi.hoisted(() => [
  { end_user_id: "e1", channel: "whatsapp", channel_account_id: "canal-a", current_conversation_id: "c1" },
  { end_user_id: "e2", channel: "whatsapp", channel_account_id: "canal-b", current_conversation_id: "c2" },
  { end_user_id: "e3", channel: "whatsapp", channel_account_id: null, current_conversation_id: "c3" },
  { end_user_id: "e4", channel: "instagram", channel_account_id: null, current_conversation_id: "c4" },
])

vi.mock("./inbox-api", () => ({
  listContacts: async () => contactos,
  listConversations: async () => [],
}))
vi.mock("./assignment", () => ({ getAssignments: async () => [] }))
vi.mock("./operator-names", () => ({ operatorNamesByIds: async () => new Map() }))

import { listEnrichedContacts } from "./inbox-contacts"

const tenant = { id: "t", aiApiUrl: "https://ai.example", aiTenantId: "ai-t" }
const ids = (l: { end_user_id: string }[]) => l.map((c) => c.end_user_id)

describe("listEnrichedContacts con actor", () => {
  it("sin actor devuelve todo (comportamiento previo)", async () => {
    expect(ids(await listEnrichedContacts(tenant))).toEqual(["e1", "e2", "e3", "e4"])
  })

  it("restringido a canal-a ve solo canal-a", async () => {
    const actor = { id: "u", role: "operator", canalesPermitidos: ["canal-a"] }
    expect(ids(await listEnrichedContacts(tenant, "active", undefined, undefined, actor))).toEqual(["e1"])
  })

  it("restringido a canal:instagram ve el contacto sin cuenta de ese canal", async () => {
    const actor = { id: "u", role: "operator", canalesPermitidos: ["canal:instagram"] }
    expect(ids(await listEnrichedContacts(tenant, "active", undefined, undefined, actor))).toEqual(["e4"])
  })

  it("admin con valor residual ve ambos canales", async () => {
    const actor = { id: "u", role: "admin", canalesPermitidos: ["canal-a"] }
    expect(ids(await listEnrichedContacts(tenant, "active", undefined, undefined, actor))).toEqual(["e1", "e2", "e3", "e4"])
  })

  it("lista vacía no ve nada; operador con NULL ve todo", async () => {
    const vacio = { id: "u", role: "operator", canalesPermitidos: [] }
    const todos = { id: "u", role: "operator", canalesPermitidos: null }
    expect(await listEnrichedContacts(tenant, "active", undefined, undefined, vacio)).toEqual([])
    expect(ids(await listEnrichedContacts(tenant, "active", undefined, undefined, todos))).toHaveLength(4)
  })
})
