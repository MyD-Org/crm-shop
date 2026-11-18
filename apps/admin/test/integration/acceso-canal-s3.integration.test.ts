import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { NextRequest } from "next/server"
import { and, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { conversationAssignments, pushSubscriptions } from "@/db/schema"
import { invalidateTenantRegistry } from "@/lib/tenants"
import { seedOperator, seedTenant, truncateAll } from "./helpers"

// Acceso por canal (S3): rutas por id, asignación (candidatos, 409, invalidación eager y lazy),
// push y pending-counts. DB real (crm_test); se mockean la sesión, web-push y el cliente de
// ai-api (inbox-api). Dominios .example; canales sintéticos "canal-a" / "canal-b".

let session: Record<string, unknown>

const ai = vi.hoisted(() => ({
  conversaciones: [] as Record<string, unknown>[],
  contactos: [] as Record<string, unknown>[],
  // true = ai-api con la ruta GET /v1/inbox/conversations/:id (S2).
  conRutaDirecta: true,
  escrituras: [] as string[],
  pushes: [] as string[],
}))

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: async (sub: { endpoint: string }) => {
      ai.pushes.push(sub.endpoint)
    },
  },
}))
vi.mock("@/lib/inbox-api", async (orig) => {
  const real = await orig<typeof import("@/lib/inbox-api")>()
  return {
    ...real,
    listConversations: async () => ai.conversaciones,
    listContacts: async () => ai.contactos,
    getConversationCanal: async (_u: string, _t: string, id: string) => {
      if (!ai.conRutaDirecta) return { status: "unsupported" }
      const c = ai.conversaciones.find((x) => x.id === id)
      return c
        ? { status: "ok", channel: c.channel, channel_account_id: c.channel_account_id ?? null }
        : { status: "not_found" }
    },
    sendReply: async (_u: string, _t: string, id: string) => {
      ai.escrituras.push(`reply:${id}`)
      return { ok: true, id: "m1" }
    },
    archiveConversation: async (_u: string, _t: string, id: string) => {
      ai.escrituras.push(`archive:${id}`)
    },
    setMode: async (_u: string, _t: string, id: string) => {
      ai.escrituras.push(`mode:${id}`)
    },
    getMessages: async () => [],
    retryMessage: async (_u: string, _t: string, id: string) => {
      ai.escrituras.push(`retry:${id}`)
      return { ok: true }
    },
    dismissMessage: async (_u: string, _t: string, id: string) => {
      ai.escrituras.push(`dismiss:${id}`)
      return { ok: true }
    },
  }
})

const { POST: reply } = await import("@/app/api/admin/inbox/[id]/reply/route")
const { POST: archive } = await import("@/app/api/admin/inbox/[id]/archive/route")
const { POST: mode } = await import("@/app/api/admin/inbox/[id]/mode/route")
const { GET: messages } = await import("@/app/api/admin/inbox/[id]/messages/route")
const { POST: retry } = await import("@/app/api/admin/inbox/[id]/messages/[messageId]/retry/route")
const { POST: dismiss } = await import("@/app/api/admin/inbox/[id]/messages/[messageId]/dismiss/route")
const { POST: assign } = await import("@/app/api/admin/inbox/[id]/assign/route")
const { GET: legacyList } = await import("@/app/api/admin/inbox/conversations/route")
const { PATCH: patchUser } = await import("@/app/api/admin/usuarios/[id]/route")
const { GET: pendingCounts, clearPendingCountsCache } = await import("@/app/api/admin/pending-counts/route")
const { POST: inboxEvent } = await import("@/app/api/internal/inbox-events/route")
const { assignPendingConversations } = await import("@/lib/assignment")

const TENANT = "tenant-a"
const HOST = `${TENANT}.localhost`
const tenantRef = { id: TENANT, aiApiUrl: "http://ai-api.test", aiTenantId: "ai-tenant-a" }

function loginAs(userId: string, role: "operator" | "admin" | "superadmin") {
  session = { mfa: "ok", userId, role, tenantId: TENANT, name: "Test", email: "t@x.example", save: async () => {} }
}
const req = (path: string, init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(`http://${HOST}${path}`, {
    method: init.method ?? "GET",
    headers: { host: HOST },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) })

async function asignacionesDe(operatorId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ c: conversationAssignments.conversationId })
    .from(conversationAssignments)
    .where(and(eq(conversationAssignments.tenantId, TENANT), eq(conversationAssignments.operatorId, operatorId)))
  return rows.map((r) => r.c).sort()
}
async function asignar(conversationId: string, operatorId: string) {
  await getDb().insert(conversationAssignments).values({ tenantId: TENANT, conversationId, operatorId, department: null })
}
async function suscribir(operatorId: string) {
  await getDb().insert(pushSubscriptions).values({
    tenantId: TENANT, operatorId, endpoint: `https://push.example/${operatorId}`, p256dh: "k", auth: "a",
  })
}

let admin: string
let operador1: string // ["canal-a"]
let operador2: string // NULL

const conv = (id: string, cuenta: string | null, extra: Record<string, unknown> = {}) => ({
  id, channel: "whatsapp", channel_account_id: cuenta, contact: "Cliente", mode: "human", status: "active",
  assigned_operator_id: null, assigned_department: null, awaiting_reply: true, last_inbound_at: null, ...extra,
})

beforeEach(async () => {
  await truncateAll()
  invalidateTenantRegistry()
  clearPendingCountsCache()
  await seedTenant(TENANT)
  admin = await seedOperator(TENANT, { role: "admin", name: "Admin", email: "admin@cliente.example" })
  operador1 = await seedOperator(TENANT, { name: "Operador 1", email: "operador1@cliente.example", canalesPermitidos: ["canal-a"] })
  operador2 = await seedOperator(TENANT, { name: "Operador 2", email: "operador2@cliente.example" })
  ai.conRutaDirecta = true
  ai.escrituras = []
  ai.pushes = []
  ai.contactos = []
  ai.conversaciones = [conv("ca", "canal-a"), conv("cb", "canal-b")]
  process.env.VAPID_PUBLIC_KEY = "pub"
  process.env.VAPID_PRIVATE_KEY = "priv"
  process.env.INTERNAL_SECRET = "secreto-de-test"
})
afterAll(truncateAll)

describe("rutas por id", () => {
  const acciones = (id: string) => [
    () => reply(req(`/api/admin/inbox/${id}/reply`, { method: "POST", body: { text: "hola" } }), ctx({ id })),
    () => archive(req(`/api/admin/inbox/${id}/archive`, { method: "POST" }), ctx({ id })),
    () => mode(req(`/api/admin/inbox/${id}/mode`, { method: "POST", body: { mode: "human" } }), ctx({ id })),
    () => messages(req(`/api/admin/inbox/${id}/messages`), ctx({ id })),
    () => retry(req(`/api/admin/inbox/${id}/messages/m1/retry`, { method: "POST" }), ctx({ id, messageId: "m1" })),
    () => dismiss(req(`/api/admin/inbox/${id}/messages/m1/dismiss`, { method: "POST" }), ctx({ id, messageId: "m1" })),
    () => assign(req(`/api/admin/inbox/${id}/assign`, { method: "POST", body: { operatorId: operador2 } }), ctx({ id })),
  ]

  it("restringido sobre canal ajeno: 404 uniforme en todas y ninguna escritura", async () => {
    loginAs(operador1, "operator")
    for (const accion of acciones("cb")) {
      const res = await accion()
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: "No encontrado", code: "not_found" })
    }
    expect(ai.escrituras).toEqual([])
    expect(await asignacionesDe(operador2)).toEqual([])
  })

  it("ajena e inexistente son indistinguibles", async () => {
    loginAs(operador1, "operator")
    const ajena = await reply(req("/api/admin/inbox/cb/reply", { method: "POST", body: { text: "x" } }), ctx({ id: "cb" }))
    const nada = await reply(req("/api/admin/inbox/nada/reply", { method: "POST", body: { text: "x" } }), ctx({ id: "nada" }))
    expect(ajena.status).toBe(nada.status)
    expect(await ajena.json()).toEqual(await nada.json())
  })

  it("restringido sobre su canal y admin sobre cualquiera: operan", async () => {
    loginAs(operador1, "operator")
    expect((await reply(req("/api/admin/inbox/ca/reply", { method: "POST", body: { text: "hola" } }), ctx({ id: "ca" }))).status).toBe(200)
    loginAs(admin, "admin")
    expect((await reply(req("/api/admin/inbox/cb/reply", { method: "POST", body: { text: "hola" } }), ctx({ id: "cb" }))).status).toBe(200)
    expect(ai.escrituras).toEqual(["reply:ca", "reply:cb"])
  })

  it("ai-api anterior a S2: resuelve por la conversación en curso de los contactos", async () => {
    ai.conRutaDirecta = false
    ai.conversaciones = [{ id: "ca", channel: "whatsapp", status: "active" }, { id: "cb", channel: "whatsapp", status: "active" }]
    ai.contactos = [
      { end_user_id: "e1", channel: "whatsapp", channel_account_id: "canal-a", current_conversation_id: "ca" },
      { end_user_id: "e2", channel: "whatsapp", channel_account_id: "canal-b", current_conversation_id: "cb" },
    ]
    loginAs(operador1, "operator")
    expect((await archive(req("/api/admin/inbox/ca/archive", { method: "POST" }), ctx({ id: "ca" }))).status).toBe(200)
    expect((await archive(req("/api/admin/inbox/cb/archive", { method: "POST" }), ctx({ id: "cb" }))).status).toBe(404)
  })

  it("revocación inmediata: quitar el canal rige en la siguiente petición", async () => {
    await getDb().update((await import("@/db/schema")).adminUsers)
      .set({ canalesPermitidos: ["canal-a", "canal-b"] })
      .where(eq((await import("@/db/schema")).adminUsers.id, operador1))
    loginAs(operador1, "operator")
    expect((await archive(req("/api/admin/inbox/cb/archive", { method: "POST" }), ctx({ id: "cb" }))).status).toBe(200)
    loginAs(admin, "admin")
    expect((await patchUser(req(`/api/admin/usuarios/${operador1}`, { method: "PATCH", body: { canales_permitidos: ["canal-a"] } }), ctx({ id: operador1 }))).status).toBe(200)
    loginAs(operador1, "operator")
    expect((await archive(req("/api/admin/inbox/cb/archive", { method: "POST" }), ctx({ id: "cb" }))).status).toBe(404)
  })

  it("listado legacy filtrado para el restringido", async () => {
    loginAs(operador1, "operator")
    const ids = ((await (await legacyList(req("/api/admin/inbox/conversations"))).json()) as { id: string }[]).map((c) => c.id)
    expect(ids).toEqual(["ca"])
    loginAs(admin, "admin")
    expect(((await (await legacyList(req("/api/admin/inbox/conversations"))).json()) as unknown[]).length).toBe(2)
  })
})

describe("asignación", () => {
  it("manual a quien no tiene el canal: 409 en usted, sin escribir", async () => {
    loginAs(admin, "admin")
    const res = await assign(req("/api/admin/inbox/cb/assign", { method: "POST", body: { operatorId: operador1 } }), ctx({ id: "cb" }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "El operador seleccionado no tiene acceso a este canal." })
    expect(await asignacionesDe(operador1)).toEqual([])
    const ok = await assign(req("/api/admin/inbox/ca/assign", { method: "POST", body: { operatorId: operador1 } }), ctx({ id: "ca" }))
    expect(ok.status).toBe(200)
  })

  it("reconciliación: solo candidatos con acceso; sin canal conocido, solo irrestrictos", async () => {
    await getDb().delete(conversationAssignments)
    const schema = await import("@/db/schema")
    await getDb().update(schema.adminUsers).set({ availability: "available" }).where(eq(schema.adminUsers.tenantId, TENANT))
    // Solo operador1 disponible: la de canal-b queda en cola.
    await getDb().update(schema.adminUsers).set({ availability: "away" }).where(eq(schema.adminUsers.id, operador2))
    await getDb().update(schema.adminUsers).set({ availability: "away" }).where(eq(schema.adminUsers.id, admin))
    ai.conversaciones = [conv("ca", "canal-a"), conv("cb", "canal-b"), { ...conv("cx", null), channel: "instagram" }]
    await assignPendingConversations(tenantRef)
    expect(await asignacionesDe(operador1)).toEqual(["ca"])
  })

  it("invalidación lazy: la asignación huérfana vuelve a la cola y se reasigna en la misma pasada", async () => {
    const schema = await import("@/db/schema")
    await getDb().update(schema.adminUsers).set({ availability: "available" }).where(eq(schema.adminUsers.id, operador2))
    await asignar("cb", operador1)
    await asignar("ca", operador1)
    await assignPendingConversations(tenantRef)
    expect(await asignacionesDe(operador1)).toEqual(["ca"])
    expect(await asignacionesDe(operador2)).toEqual(["cb"])
  })

  it("canal DESCONOCIDO no invalida (ai-api viejo sin rastro)", async () => {
    ai.conversaciones = [{ id: "vieja", channel: "whatsapp", mode: "human", status: "active" }]
    await asignar("vieja", operador1)
    await assignPendingConversations(tenantRef)
    expect(await asignacionesDe(operador1)).toEqual(["vieja"])
  })

  it("invalidación eager en el PATCH: [A,B] → [A] devuelve solo las de B", async () => {
    const schema = await import("@/db/schema")
    await getDb().update(schema.adminUsers).set({ canalesPermitidos: ["canal-a", "canal-b"] }).where(eq(schema.adminUsers.id, operador1))
    ai.conversaciones = [conv("ca", "canal-a"), conv("cb1", "canal-b"), conv("cb2", "canal-b")]
    for (const c of ["ca", "cb1", "cb2"]) await asignar(c, operador1)
    loginAs(admin, "admin")
    const res = await patchUser(req(`/api/admin/usuarios/${operador1}`, { method: "PATCH", body: { canales_permitidos: ["canal-a"] } }), ctx({ id: operador1 }))
    expect(res.status).toBe(200)
    expect((await res.json()).asignaciones_devueltas).toBe(2)
    expect(await asignacionesDe(operador1)).toEqual(["ca"])
  })

  it("lista vacía devuelve todas; editar solo el nombre no toca nada", async () => {
    for (const c of ["ca"]) await asignar(c, operador1)
    loginAs(admin, "admin")
    const nombre = await patchUser(req(`/api/admin/usuarios/${operador1}`, { method: "PATCH", body: { name: "Otro" } }), ctx({ id: operador1 }))
    expect((await nombre.json()).asignaciones_devueltas).toBeUndefined()
    expect(await asignacionesDe(operador1)).toEqual(["ca"])
    const vacia = await patchUser(req(`/api/admin/usuarios/${operador1}`, { method: "PATCH", body: { canales_permitidos: [] } }), ctx({ id: operador1 }))
    expect((await vacia.json()).asignaciones_devueltas).toBe(1)
    expect(await asignacionesDe(operador1)).toEqual([])
  })
})

describe("push", () => {
  const evento = (body: Record<string, unknown>) =>
    inboxEvent(new Request("http://crm.example/api/internal/inbox-events", {
      method: "POST",
      headers: { authorization: "Bearer secreto-de-test" },
      body: JSON.stringify({ tenantId: tenantRef.aiTenantId, ...body }),
    }))

  beforeEach(async () => {
    const schema = await import("@/db/schema")
    await getDb().update(schema.adminUsers).set({ availability: "available", departments: ["ventas"] })
      .where(eq(schema.adminUsers.tenantId, TENANT))
    await getDb().update(schema.adminUsers).set({ departments: [] }).where(eq(schema.adminUsers.id, admin))
    for (const id of [admin, operador1, operador2]) await suscribir(id)
  })

  it("handoff a depto en canal-b: solo operador2", async () => {
    await evento({ event: "handoff", conversationId: "cb", department: "ventas", channel: "whatsapp", channelAccountId: "canal-b" })
    expect(ai.pushes).toEqual([`https://push.example/${operador2}`])
  })

  it("nadie del depto con acceso: cae a admin y superadmin", async () => {
    const schema = await import("@/db/schema")
    await getDb().update(schema.adminUsers).set({ availability: "away" }).where(eq(schema.adminUsers.id, operador2))
    await evento({ event: "handoff", conversationId: "cb", department: "ventas", channel: "whatsapp", channelAccountId: "canal-b" })
    expect(ai.pushes).toEqual([`https://push.example/${admin}`])
  })

  it("asignado sin acceso no recibe; con payload viejo se resuelve contra ai-api", async () => {
    await asignar("cb", operador1)
    await evento({ event: "inbound", conversationId: "cb" })
    expect(ai.pushes).toEqual([])
    await asignar("ca", operador1)
    await evento({ event: "inbound", conversationId: "ca" })
    expect(ai.pushes).toEqual([`https://push.example/${operador1}`])
  })
})

describe("pending-counts por usuario con el cache compartido", () => {
  beforeEach(() => {
    ai.conversaciones = [
      conv("a1", "canal-a"), conv("a2", "canal-a"), conv("a3", "canal-a"),
      conv("b1", "canal-b"), conv("b2", "canal-b"),
    ]
  })
  const contar = async () => (await (await pendingCounts(req("/api/admin/pending-counts"))).json()).inbox

  it("admin primero y después el restringido", async () => {
    loginAs(admin, "admin")
    expect(await contar()).toBe(5)
    loginAs(operador1, "operator")
    expect(await contar()).toBe(3)
  })

  it("restringido primero y después el admin", async () => {
    loginAs(operador1, "operator")
    expect(await contar()).toBe(3)
    loginAs(admin, "admin")
    expect(await contar()).toBe(5)
  })
})
