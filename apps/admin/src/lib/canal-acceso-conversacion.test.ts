import { describe, it, expect, beforeEach, vi } from "vitest"

// Resolución conversationId → canal y el chequeo de las rutas por id (acceso por canal, S3).
// Se mockea el cliente de ai-api: interesa qué fuente se usa y que un irrestricto no pague nada.

const ai = vi.hoisted(() => ({
  directa: { status: "unsupported" } as Record<string, unknown>,
  conversaciones: [] as Record<string, unknown>[],
  contactos: [] as Record<string, unknown>[],
  llamadas: [] as string[],
}))

vi.mock("@/lib/inbox-api", async (orig) => {
  const real = await orig<typeof import("@/lib/inbox-api")>()
  return {
    ...real,
    getConversationCanal: async (_u: string, _t: string, id: string) => {
      ai.llamadas.push(`directa:${id}`)
      return ai.directa
    },
    listConversations: async () => {
      ai.llamadas.push("conversaciones")
      return ai.conversaciones
    },
    listContacts: async (_u: string, _t: string, scope: string) => {
      ai.llamadas.push(`contactos:${scope}`)
      return ai.contactos
    },
  }
})

const {
  canalDeConversacion,
  canalesDeConversaciones,
  cuentaDeConversacion,
  exigirAccesoConversacion,
} = await import("./canal-acceso-conversacion")
const { adminNotFoundResponse } = await import("./admin-route-guard")

const TENANT = { aiApiUrl: "http://ai.test", aiTenantId: "ai-a" }
const operador1 = { id: "op1", role: "operator", canalesPermitidos: ["canal-a"] }
const operadorTodos = { id: "op2", role: "operator", canalesPermitidos: null }
const admin = { id: "ad", role: "admin", canalesPermitidos: ["canal-a"] }

beforeEach(() => {
  ai.directa = { status: "unsupported" }
  ai.conversaciones = []
  ai.contactos = []
  ai.llamadas = []
})

describe("canalDeConversacion", () => {
  it("con el campo (S2): la cuenta, o canal:<canal> si es null", () => {
    expect(canalDeConversacion({ channel: "whatsapp", channel_account_id: "canal-a" })).toBe("canal-a")
    expect(canalDeConversacion({ channel: "instagram", channel_account_id: null })).toBe("canal:instagram")
  })
  it("sin el campo (ai-api viejo): desconocido, no canal:<canal>", () => {
    expect(canalDeConversacion({ channel: "whatsapp" })).toBeUndefined()
  })
})

describe("canalesDeConversaciones", () => {
  it("con S2 no consulta contactos", async () => {
    const m = await canalesDeConversaciones(TENANT, [
      { id: "c1", channel: "whatsapp", channel_account_id: "canal-a" },
      { id: "c2", channel: "whatsapp", channel_account_id: "canal-b" },
    ])
    expect([...m]).toEqual([["c1", "canal-a"], ["c2", "canal-b"]])
    expect(ai.llamadas).toEqual([])
  })
  it("sin S2: una sola consulta de contactos para la conversación en curso; el resto, desconocida", async () => {
    ai.contactos = [{ end_user_id: "e1", channel: "whatsapp", channel_account_id: "canal-a", current_conversation_id: "c1" }]
    const m = await canalesDeConversaciones(TENANT, [
      { id: "c1", channel: "whatsapp" },
      { id: "vieja", channel: "whatsapp" },
    ])
    expect(m.get("c1")).toBe("canal-a")
    expect(m.has("vieja")).toBe(false)
    expect(ai.llamadas).toEqual(["contactos:all"])
  })
})

describe("cuentaDeConversacion", () => {
  it("usa la ruta directa de ai-api (S2)", async () => {
    ai.directa = { status: "ok", channel: "whatsapp", channel_account_id: "canal-b" }
    expect(await cuentaDeConversacion(TENANT, "c1")).toBe("canal-b")
    expect(ai.llamadas).toEqual(["directa:c1"])
  })
  it("not_found de la ruta directa: null sin más consultas", async () => {
    ai.directa = { status: "not_found" }
    expect(await cuentaDeConversacion(TENANT, "c1")).toBeNull()
    expect(ai.llamadas).toEqual(["directa:c1"])
  })
  it("ai-api sin la ruta: listado legacy con el campo", async () => {
    ai.conversaciones = [{ id: "c1", channel: "whatsapp", channel_account_id: "canal-a" }]
    expect(await cuentaDeConversacion(TENANT, "c1")).toBe("canal-a")
  })
  it("ai-api anterior a S2: cae a los contactos", async () => {
    ai.conversaciones = [{ id: "c1", channel: "whatsapp" }]
    ai.contactos = [{ end_user_id: "e1", channel: "whatsapp", channel_account_id: "canal-a", current_conversation_id: "c1" }]
    expect(await cuentaDeConversacion(TENANT, "c1")).toBe("canal-a")
  })
  it("sin rastro en ninguna fuente: null", async () => {
    expect(await cuentaDeConversacion(TENANT, "c1")).toBeNull()
  })
})

describe("exigirAccesoConversacion", () => {
  it("irrestricto (admin con valor residual, operador NULL): ok SIN llamar a ai-api", async () => {
    expect(await exigirAccesoConversacion(TENANT, admin, "c1")).toEqual({ ok: true })
    expect(await exigirAccesoConversacion(TENANT, operadorTodos, "c1")).toEqual({ ok: true })
    expect(ai.llamadas).toEqual([])
  })
  it("restringido con el canal: ok y devuelve la clave resuelta", async () => {
    ai.directa = { status: "ok", channel: "whatsapp", channel_account_id: "canal-a" }
    expect(await exigirAccesoConversacion(TENANT, operador1, "c1")).toEqual({ ok: true, canalKey: "canal-a" })
  })
  it("ajena e inexistente responden lo mismo (404 uniforme)", async () => {
    ai.directa = { status: "ok", channel: "whatsapp", channel_account_id: "canal-b" }
    const ajena = await exigirAccesoConversacion(TENANT, operador1, "c2")
    ai.directa = { status: "not_found" }
    const inexistente = await exigirAccesoConversacion(TENANT, operador1, "nada")
    expect(ajena.ok).toBe(false)
    expect(inexistente.ok).toBe(false)
    if (ajena.ok || inexistente.ok) return
    const esperado = adminNotFoundResponse()
    for (const r of [ajena.response, inexistente.response]) {
      expect(r.status).toBe(esperado.status)
      expect(await r.json()).toEqual(await esperado.clone().json())
    }
  })
  it("canal sin resolver (ai-api viejo, conversación vieja): denegado", async () => {
    ai.conversaciones = [{ id: "vieja", channel: "whatsapp" }]
    expect((await exigirAccesoConversacion(TENANT, operador1, "vieja")).ok).toBe(false)
  })
  it("lista vacía: denegado aunque el canal exista", async () => {
    ai.directa = { status: "ok", channel: "whatsapp", channel_account_id: "canal-a" }
    expect((await exigirAccesoConversacion(TENANT, { ...operador1, canalesPermitidos: [] }, "c1")).ok).toBe(false)
  })
})
