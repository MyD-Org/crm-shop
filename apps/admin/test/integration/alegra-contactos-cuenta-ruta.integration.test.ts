import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { and, eq } from "drizzle-orm"
import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraContacts } from "@/db/schema"
import { seedTenant, truncateAll } from "./helpers"

// Ruta pública de avisos de contactos de una cuenta secundaria (change `espejo-contactos-por-cuenta`,
// rebanada A): auth por token de la CUENTA, 404 uniforme y el aviso se aplica en `after`, escribiendo
// SOLO la fila de esa cuenta. Alegra queda mockeado: ninguna llamada sale a la red.

const state = vi.hoisted(() => ({ pendientes: [] as (() => Promise<void>)[] }))
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => void state.pendientes.push(fn) }))

const { GET, POST } = await import("@/app/api/webhooks/alegra/contactos-cuenta/[cuenta]/[evento]/[token]/route")
const { tokenWebhookContactosCuenta, tokenWebhookContactos } = await import("@/lib/alegra-contacts-webhook")
const { tokenWebhookStockCuenta } = await import("@/lib/alegra-stock-webhook")

const A = "tenant-a"
const SECRETO = "w".repeat(40)
const db = () => getDb()
const filas = async (q: ReturnType<typeof sql>) => [...(await db().execute(q))] as Record<string, unknown>[]

let cuentaMdp: string
let cuentaIgz: string

const llamar = (cuenta: string, evento: string, token: string, body?: unknown) =>
  POST(
    new Request(`https://crm.example/api/webhooks/alegra/contactos-cuenta/${cuenta}/${evento}/${token}`, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ cuenta, evento, token }) },
  )

const correrAfter = async () => {
  for (const fn of state.pendientes.splice(0)) await fn()
}

const contacto = (id: number, extra: Record<string, unknown> = {}) => ({ id, name: `Cliente ${id}`, status: "active", type: ["client"], ...extra })
const filaDe = async (cuenta: string, alegraId: string) => {
  const [row] = await db()
    .select()
    .from(alegraContacts)
    .where(and(eq(alegraContacts.tenantId, A), eq(alegraContacts.alegraAccount, cuenta), eq(alegraContacts.alegraId, alegraId)))
  return row
}

const fetchMock = vi.fn()

beforeEach(async () => {
  vi.stubEnv("ALEGRA_WEBHOOK_SECRET", SECRETO)
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockReset()
  state.pendientes = []
  await truncateAll()
  await db().execute(sql`truncate table alegra_cuentas restart identity cascade`)
  await seedTenant(A)
  await db().execute(sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre, principal) VALUES (${A}, 'principal', 'Iguazú', true)`)
  await db().execute(sql`INSERT INTO alegra_cuentas (tenant_id, slug, nombre, alegra_email, alegra_token) VALUES (${A}, 'mdp', 'Mar del Plata', 'm@cliente.example', 'tok-mdp')`)
  ;[{ id: cuentaMdp }] = (await filas(sql`SELECT id FROM alegra_cuentas WHERE slug = 'mdp'`)) as { id: string }[]
  ;[{ id: cuentaIgz }] = (await filas(sql`SELECT id FROM alegra_cuentas WHERE principal`)) as { id: string }[]
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
afterAll(async () => {
  await truncateAll()
})

describe("POST /api/webhooks/alegra/contactos-cuenta/<cuenta>/<evento>/<token>", () => {
  it("token válido: 200 enseguida y el aviso se aplica después, solo en la cuenta", async () => {
    const aviso = { subject: "edit-client", message: { client: contacto(7, { name: "MDP Nuevo" }) } }
    const res = await llamar(cuentaMdp, "edit-client", tokenWebhookContactosCuenta(cuentaMdp)!, aviso)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    // Todavía no escribió nada: el trabajo va en `after`.
    expect(await filaDe("mdp", "7")).toBeUndefined()
    expect(state.pendientes).toHaveLength(1)

    await correrAfter()
    expect(await filaDe("mdp", "7")).toMatchObject({ name: "MDP Nuevo", origen: "webhook" })
    expect(await filaDe("principal", "7")).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("delete-client: baja solo ('mdp', 7)", async () => {
    const { upsertContactos } = await import("@/lib/alegra-contacts-repo")
    const { mapRawContactRow } = await import("@/lib/alegra")
    await upsertContactos(A, [mapRawContactRow(contacto(7))], "sync")
    await upsertContactos(A, [mapRawContactRow(contacto(7))], "sync", { cuenta: "mdp" })

    await llamar(cuentaMdp, "delete-client", tokenWebhookContactosCuenta(cuentaMdp)!, { message: { client: { id: 7 } } })
    await correrAfter()
    expect((await filaDe("mdp", "7")).status).toBe("inactive")
    expect((await filaDe("principal", "7")).status).toBe("active")
  })

  it("con solo el id lee el contacto con las credenciales de ESA cuenta (no las de la principal)", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(contacto(9, { name: "Leído de MDP" })), { status: 200 }))
    await llamar(cuentaMdp, "new-client", tokenWebhookContactosCuenta(cuentaMdp)!, { id: 9 })
    await correrAfter()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
    const auth = Object.entries(init.headers).find(([k]) => k.toLowerCase() === "authorization")?.[1]
    expect(auth).toBe(`Basic ${Buffer.from("m@cliente.example:tok-mdp").toString("base64")}`)
    expect(await filaDe("mdp", "9")).toMatchObject({ name: "Leído de MDP" })
  })

  it("404 uniforme (mismo cuerpo) y sin escritura ante token de otra cuenta, de la principal, de otro dominio o vacío", async () => {
    const tokens = [
      tokenWebhookContactosCuenta(cuentaIgz)!,
      tokenWebhookContactos(A)!,
      tokenWebhookContactos(cuentaMdp)!,
      tokenWebhookStockCuenta(cuentaMdp)!,
      "x".repeat(32),
      "",
    ]
    for (const token of tokens) {
      const res = await llamar(cuentaMdp, "edit-client", token, { message: { client: contacto(7) } })
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: "not_found" })
    }
    expect(state.pendientes).toHaveLength(0)
    expect(await filas(sql`SELECT 1 FROM alegra_contacts`)).toHaveLength(0)
  })

  it("la cuenta principal, una inactiva, un uuid inexistente o inválido y un evento desconocido dan el mismo 404", async () => {
    const inexistente = "33333333-3333-4333-8333-333333333333"
    const casos: [string, string, string][] = [
      [cuentaIgz, "edit-client", tokenWebhookContactosCuenta(cuentaIgz)!],
      [cuentaMdp, "new-invoice", tokenWebhookContactosCuenta(cuentaMdp)!],
      [inexistente, "edit-client", tokenWebhookContactosCuenta(inexistente)!],
      ["no-es-uuid", "edit-client", "a".repeat(32)],
    ]
    for (const [c, e, t] of casos) {
      const res = await llamar(c, e, t, { id: 1 })
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: "not_found" })
    }
    await db().execute(sql`UPDATE alegra_cuentas SET activa = false WHERE slug = 'mdp'`)
    const res = await llamar(cuentaMdp, "edit-client", tokenWebhookContactosCuenta(cuentaMdp)!, { id: 1 })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "not_found" })
    expect(state.pendientes).toHaveLength(0)
  })

  it("cuenta activa sin credenciales: 404 uniforme (no hay con qué leer)", async () => {
    await db().execute(sql`UPDATE alegra_cuentas SET alegra_email = '', alegra_token = '' WHERE slug = 'mdp'`)
    const res = await llamar(cuentaMdp, "edit-client", tokenWebhookContactosCuenta(cuentaMdp)!, { id: 1 })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "not_found" })
  })

  it("sin secreto configurado falla cerrado (404)", async () => {
    const token = tokenWebhookContactosCuenta(cuentaMdp)!
    vi.stubEnv("ALEGRA_WEBHOOK_SECRET", "")
    expect((await llamar(cuentaMdp, "edit-client", token, { id: 1 })).status).toBe(404)
  })

  it("el log no incluye el cuerpo ni el token", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const token = tokenWebhookContactosCuenta(cuentaMdp)!
    await llamar(cuentaMdp, "edit-client", token, { message: { client: contacto(7, { name: "Dato Reservado", email: "reservado@cliente.example" }) } })
    await correrAfter()
    const texto = [...log.mock.calls, ...warn.mock.calls].flat().map(String).join(" ")
    expect(texto).toContain("tenant=tenant-a")
    expect(texto).toContain("cuenta=mdp")
    expect(texto).toContain("evento=edit-client")
    expect(texto).toContain("accion=upsert_directo")
    expect(texto).toContain("id=7")
    expect(texto).not.toContain("Dato Reservado")
    expect(texto).not.toContain("reservado@cliente.example")
    expect(texto).not.toContain(token)
  })

  it("GET (verificación manual): 200 con token válido y 404 con otro; no toca nada", async () => {
    const ok = await GET(new Request("https://crm.example/x"), {
      params: Promise.resolve({ cuenta: cuentaMdp, evento: "edit-client", token: tokenWebhookContactosCuenta(cuentaMdp)! }),
    })
    expect(ok.status).toBe(200)
    const no = await GET(new Request("https://crm.example/x"), {
      params: Promise.resolve({ cuenta: cuentaMdp, evento: "edit-client", token: "x".repeat(32) }),
    })
    expect(no.status).toBe(404)
  })
})
