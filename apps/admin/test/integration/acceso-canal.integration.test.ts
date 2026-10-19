import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { NextRequest } from "next/server"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { adminUsers } from "@/db/schema"
import { invalidateTenantRegistry } from "@/lib/tenants"
import { seedOperator, seedTenant, truncateAll } from "./helpers"

// Acceso por canal (S1): columna admin_users.canales_permitidos (0092), PATCH de usuarios, selector
// de canales y la lectura del inbox (lista y detalle) filtrada por canal. DB real (crm_test); se
// mockean la sesión y el cliente de ai-api (inbox-api).
//
// Dominios .example; canales sintéticos "canal-a" / "canal-b".

let session: Record<string, unknown>

const ai = vi.hoisted(() => ({
  contactos: [] as Record<string, unknown>[],
  numeros: [] as unknown[],
}))

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))
vi.mock("@/lib/inbox-api", async (orig) => {
  const real = await orig<typeof import("@/lib/inbox-api")>()
  return {
    ...real,
    listContacts: async () => ai.contactos,
    listConversations: async () => [],
    getContact: async (_u: string, _t: string, endUserId: string, cuenta?: string | null) => {
      // ai-api devuelve el hilo pedido por ?account=, o el primero del end_user.
      const delUsuario = ai.contactos.filter((c) => c.end_user_id === endUserId)
      const hilo = delUsuario.find((c) => !cuenta || c.channel_account_id === cuenta) ?? delUsuario[0]
      if (!hilo) throw new Error("ai-api error 404")
      return hilo
    },
    listWhatsappNumbersRaw: async () => Response.json(ai.numeros),
  }
})

const { PATCH: patchUser } = await import("@/app/api/admin/usuarios/[id]/route")
const { GET: listUsers, POST: invite } = await import("@/app/api/admin/usuarios/route")
const { GET: canalesOpciones } = await import("@/app/api/admin/usuarios/canales/route")
const { GET: listContactos } = await import("@/app/api/admin/inbox/contacts/route")
const { GET: detalleContacto } = await import("@/app/api/admin/inbox/contacts/[endUserId]/route")
const { GET: numerosWa } = await import("@/app/api/admin/whatsapp-numbers/route")
const { GET: nombresCanales } = await import("@/app/api/admin/inbox/canales/route")
const { getGuardedAdminSession } = await import("@/lib/admin-session")

const TENANT = "tenant-a"
const HOST = `${TENANT}.localhost`

function loginAs(userId: string, role: "operator" | "admin" | "superadmin") {
  session = { userId, role, tenantId: TENANT, name: "Test", email: "t@x.example", save: async () => {} }
}
const patch = (id: string, body: unknown) =>
  patchUser(new NextRequest(`http://${HOST}/api/admin/usuarios/${id}`, { method: "PATCH", body: JSON.stringify(body), headers: { host: HOST } }), {
    params: Promise.resolve({ id }),
  })
const get = (path: string) => new NextRequest(`http://${HOST}${path}`, { headers: { host: HOST } })
const canalesDe = async (id: string) =>
  (await getDb().select({ c: adminUsers.canalesPermitidos }).from(adminUsers).where(eq(adminUsers.id, id)))[0].c

let admin: string
let operador: string

beforeEach(async () => {
  await truncateAll()
  invalidateTenantRegistry()
  await seedTenant(TENANT)
  admin = await seedOperator(TENANT, { role: "admin", name: "Admin" })
  operador = await seedOperator(TENANT, { role: "operator", name: "Operador 1", email: "operador1@cliente.example" })
  ai.contactos = [
    { end_user_id: "e1", channel: "whatsapp", channel_account_id: "canal-a", current_conversation_id: "c1", business_phone: "+54 11 0000-0001", awaiting_reply: true },
    { end_user_id: "e2", channel: "whatsapp", channel_account_id: "canal-b", current_conversation_id: "c2", business_phone: "+54 11 0000-0002", awaiting_reply: true },
    // Mismo cliente escribiendo a los dos números.
    { end_user_id: "e3", channel: "whatsapp", channel_account_id: "canal-a", current_conversation_id: "c3a", business_phone: "+54 11 0000-0001", awaiting_reply: false },
    { end_user_id: "e3", channel: "whatsapp", channel_account_id: "canal-b", current_conversation_id: "c3b", business_phone: "+54 11 0000-0002", awaiting_reply: false },
  ]
  ai.numeros = [
    { channelAccountId: "canal-a", displayPhoneNumber: "+54 11 0000-0001" },
    { channelAccountId: "canal-b", displayPhoneNumber: "+54 11 0000-0002" },
  ]
})
afterAll(truncateAll)

describe("columna canales_permitidos (0092)", () => {
  it("los usuarios existentes y nuevos quedan en NULL (todos los canales)", async () => {
    expect(await canalesDe(operador)).toBeNull()
    expect(await canalesDe(admin)).toBeNull()
    loginAs(admin, "admin")
    const res = await invite(
      new NextRequest(`http://${HOST}/api/admin/usuarios`, {
        method: "POST",
        body: JSON.stringify({ name: "Nuevo", email: "nuevo@cliente.example", role: "operator" }),
        headers: { host: HOST },
      }),
    )
    expect(res.status).toBe(201)
    const [nuevo] = await getDb().select().from(adminUsers).where(eq(adminUsers.email, "nuevo@cliente.example"))
    expect(nuevo.canalesPermitidos).toBeNull()
  })

  it("persiste NULL, [] y una lista (round-trip)", async () => {
    loginAs(admin, "admin")
    expect((await patch(operador, { canales_permitidos: ["canal-a", "canal:instagram"] })).status).toBe(200)
    expect(await canalesDe(operador)).toEqual(["canal-a", "canal:instagram"])
    expect((await patch(operador, { canales_permitidos: [] })).status).toBe(200)
    expect(await canalesDe(operador)).toEqual([])
    expect((await patch(operador, { canales_permitidos: null })).status).toBe(200)
    expect(await canalesDe(operador)).toBeNull()
  })

  it("el guard expone el valor FRESCO de la fila (revocación sin relogin)", async () => {
    loginAs(operador, "operator")
    const antes = await getGuardedAdminSession(get("/x"))
    expect(antes.ok && antes.user.canalesPermitidos).toBeNull()
    await getDb().update(adminUsers).set({ canalesPermitidos: ["canal-a"] }).where(eq(adminUsers.id, operador))
    const despues = await getGuardedAdminSession(get("/x"))
    expect(despues.ok && despues.user.canalesPermitidos).toEqual(["canal-a"])
  })
})

describe("PATCH usuarios: canales_permitidos", () => {
  it("responde con el valor guardado", async () => {
    loginAs(admin, "admin")
    const res = await patch(operador, { canales_permitidos: ["canal-a"] })
    expect(res.status).toBe(200)
    expect((await res.json()).canales_permitidos).toEqual(["canal-a"])
  })

  it("sobre uno mismo → 403 y no cambia nada", async () => {
    loginAs(admin, "admin")
    const res = await patch(admin, { canales_permitidos: ["canal-a"] })
    expect(res.status).toBe(403)
    expect(await canalesDe(admin)).toBeNull()
  })

  it("un operador no puede cambiar canales de nadie → 403", async () => {
    const otro = await seedOperator(TENANT, { role: "operator" })
    loginAs(operador, "operator")
    expect((await patch(otro, { canales_permitidos: [] })).status).toBe(403)
    expect(await canalesDe(otro)).toBeNull()
    expect((await patch(operador, { canales_permitidos: ["canal-a"] })).status).toBe(403)
    expect(await canalesDe(operador)).toBeNull()
  })

  it("sobre un admin con valor no NULL → 400 en usted; con null se acepta", async () => {
    loginAs(admin, "admin")
    const otroAdmin = await seedOperator(TENANT, { role: "admin" })
    const res = await patch(otroAdmin, { canales_permitidos: ["canal-a"] })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Solo los operadores pueden tener canales restringidos.")
    expect(await canalesDe(otroAdmin)).toBeNull()
    expect((await patch(otroAdmin, { canales_permitidos: null })).status).toBe(200)
  })

  it.each([["canal-a"], [[""]], [["x", "x"]], [{}], [[1]]])("payload inválido %j → 400", async (raw) => {
    loginAs(admin, "admin")
    expect((await patch(operador, { canales_permitidos: raw })).status).toBe(400)
    expect(await canalesDe(operador)).toBeNull()
  })

  it("promover un operador restringido a admin deja la columna en NULL", async () => {
    await getDb().update(adminUsers).set({ canalesPermitidos: ["canal-a"] }).where(eq(adminUsers.id, operador))
    loginAs(admin, "admin")
    expect((await patch(operador, { role: "admin" })).status).toBe(200)
    expect(await canalesDe(operador)).toBeNull()
  })

  it("editar solo nombre o departamentos no toca la columna", async () => {
    await getDb().update(adminUsers).set({ canalesPermitidos: ["canal-a"] }).where(eq(adminUsers.id, operador))
    loginAs(admin, "admin")
    expect((await patch(operador, { name: "Renombrado", departments: ["ventas"] })).status).toBe(200)
    expect(await canalesDe(operador)).toEqual(["canal-a"])
  })

  it("el listado de usuarios incluye canales_permitidos", async () => {
    await getDb().update(adminUsers).set({ canalesPermitidos: [] }).where(eq(adminUsers.id, operador))
    loginAs(admin, "admin")
    const lista = (await (await listUsers(get("/api/admin/usuarios"))).json()) as { id: string; canales_permitidos: string[] | null }[]
    expect(lista.find((u) => u.id === operador)?.canales_permitidos).toEqual([])
    expect(lista.find((u) => u.id === admin)?.canales_permitidos).toBeNull()
  })
})

describe("GET usuarios/canales (opciones del selector)", () => {
  it("lista los números e incluye las claves huérfanas ya guardadas", async () => {
    await getDb().update(adminUsers).set({ canalesPermitidos: ["canal-vieja"] }).where(eq(adminUsers.id, operador))
    loginAs(admin, "admin")
    const res = await canalesOpciones(get("/api/admin/usuarios/canales"))
    expect(res.status).toBe(200)
    const { canales } = (await res.json()) as { canales: { key: string; label: string }[] }
    const keys = canales.map((c) => c.key)
    expect(keys).toEqual(expect.arrayContaining(["canal-a", "canal-b", "canal-vieja"]))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("un operador recibe 404 (rol insuficiente)", async () => {
    loginAs(operador, "operator")
    expect((await canalesOpciones(get("/api/admin/usuarios/canales"))).status).toBe(404)
  })
})

describe("lectura del inbox filtrada por canal", () => {
  const idsLista = async () =>
    ((await (await listContactos(get("/api/admin/inbox/contacts"))).json()) as { end_user_id: string; channel_account_id: string }[]).map(
      (c) => `${c.end_user_id}@${c.channel_account_id}`,
    )

  it("el restringido a canal-a lista solo canal-a; admin y operador con NULL ven todo", async () => {
    await getDb().update(adminUsers).set({ canalesPermitidos: ["canal-a"] }).where(eq(adminUsers.id, operador))
    loginAs(operador, "operator")
    expect(await idsLista()).toEqual(["e1@canal-a", "e3@canal-a"])
    loginAs(admin, "admin")
    expect(await idsLista()).toHaveLength(4)
    await getDb().update(adminUsers).set({ canalesPermitidos: null }).where(eq(adminUsers.id, operador))
    loginAs(operador, "operator")
    expect(await idsLista()).toHaveLength(4)
  })

  it("un contacto sin cuenta se oculta al restringido (fail-closed)", async () => {
    ai.contactos.push({ end_user_id: "e9", channel: "whatsapp", channel_account_id: null, current_conversation_id: "c9", business_phone: null, awaiting_reply: true })
    await getDb().update(adminUsers).set({ canalesPermitidos: ["canal-a"] }).where(eq(adminUsers.id, operador))
    loginAs(operador, "operator")
    expect((await idsLista()).some((i) => i.startsWith("e9"))).toBe(false)
    loginAs(admin, "admin")
    expect((await idsLista()).some((i) => i.startsWith("e9"))).toBe(true)
  })

  const detalle = (id: string, cuenta?: string) =>
    detalleContacto(get(`/api/admin/inbox/contacts/${id}${cuenta ? `?cuenta=${cuenta}` : ""}`), { params: Promise.resolve({ endUserId: id }) })

  it("link directo a un canal ajeno: 404 con cuerpo IDÉNTICO al de un contacto inexistente", async () => {
    await getDb().update(adminUsers).set({ canalesPermitidos: ["canal-a"] }).where(eq(adminUsers.id, operador))
    loginAs(operador, "operator")
    const ajeno = await detalle("e2")
    const inexistente = await detalle("no-existe")
    expect(ajeno.status).toBe(404)
    expect(inexistente.status).toBe(404)
    expect(await ajeno.json()).toEqual(await inexistente.json())
    expect((await detalle("e1")).status).toBe(200)
  })

  it("?cuenta= manipulado: se valida el hilo que devuelve ai-api, no el query", async () => {
    await getDb().update(adminUsers).set({ canalesPermitidos: ["canal-a"] }).where(eq(adminUsers.id, operador))
    loginAs(operador, "operator")
    // Pide ?cuenta=canal-b: ai-api devuelve el hilo de canal-b → 404.
    expect((await detalle("e3", "canal-b")).status).toBe(404)
    // Aunque el query diga canal-a, si ai-api devolviera canal-b se niega; y con canal-a, pasa.
    const ok = await detalle("e3", "canal-a")
    expect(ok.status).toBe(200)
    expect((await ok.json()).channel_account_id).toBe("canal-a")
  })

  it("el admin ve cualquier canal en el detalle", async () => {
    loginAs(admin, "admin")
    expect((await detalle("e2")).status).toBe(200)
  })

  it("whatsapp-numbers: el restringido solo ve sus números; el resto, la respuesta completa", async () => {
    await getDb().update(adminUsers).set({ canalesPermitidos: ["canal-a"] }).where(eq(adminUsers.id, operador))
    loginAs(operador, "operator")
    expect(await (await numerosWa(get("/api/admin/whatsapp-numbers"))).json()).toEqual([ai.numeros[0]])
    loginAs(admin, "admin")
    expect(await (await numerosWa(get("/api/admin/whatsapp-numbers"))).json()).toEqual(ai.numeros)
  })

  it("inbox/canales (nombres): el restringido no recibe los nombres de canales ajenos", async () => {
    const { guardarNombres } = await import("@/lib/inbox-canales-repo")
    await guardarNombres(TENANT, { "canal-a": "Sucursal A", "canal-b": "Sucursal B" })
    await getDb().update(adminUsers).set({ canalesPermitidos: ["canal-a"] }).where(eq(adminUsers.id, operador))
    loginAs(operador, "operator")
    expect((await (await nombresCanales(get("/api/admin/inbox/canales"))).json()).nombres).toEqual({ "canal-a": "Sucursal A" })
    loginAs(admin, "admin")
    expect((await (await nombresCanales(get("/api/admin/inbox/canales"))).json()).nombres).toEqual({
      "canal-a": "Sucursal A",
      "canal-b": "Sucursal B",
    })
  })
})
