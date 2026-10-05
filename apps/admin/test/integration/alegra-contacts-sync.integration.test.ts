import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest"
import { and, desc, eq } from "drizzle-orm"
import postgres from "postgres"
import { getDb } from "@/db"
import { alegraContacts, alegraContactsSyncLog } from "@/db/schema"
import { syncContacts } from "@/lib/alegra-contacts-sync"
import type { TenantConfig } from "@/lib/tenants"
import { seedTenant, truncateAll } from "./helpers"

/**
 * Sync del espejo de contactos contra Postgres real (crm_test) y Alegra MOCKEADO (fetch
 * stubeado: ninguna llamada sale a la red). Datos inventados.
 */

const TENANT = "tenant-a"
const config = {
  id: TENANT,
  alegraMock: false,
  alegraEmail: "api@plataforma.example",
  alegraToken: "token-de-prueba",
} as unknown as TenantConfig

type Raw = Record<string, unknown>
const contacto = (id: number, extra: Raw = {}): Raw => ({
  id,
  name: `Cliente ${id}`,
  status: "active",
  type: ["client"],
  ...extra,
})
const padronDe = (n: number, extra: (id: number) => Raw = () => ({})) =>
  Array.from({ length: n }, (_, i) => contacto(i + 1, extra(i + 1)))

const fetchMock = vi.fn()
/** `start` de cada request a /contacts, en orden. */
let starts: number[] = []

/**
 * Sirve `padron` paginado por ?start=. `fallaEnStart` devuelve 500 en esa página;
 * `limiteEnStart` devuelve el 400 con {"code":429} con que Alegra corta /contacts.
 */
function alegraSirve(padron: Raw[], opts: { fallaEnStart?: number; limiteEnStart?: number; cuerpoError?: string } = {}) {
  fetchMock.mockImplementation(async (url: string) => {
    const start = Number(new URL(url).searchParams.get("start"))
    starts.push(start)
    if (opts.fallaEnStart === start) return new Response(opts.cuerpoError ?? "boom", { status: 500 })
    if (opts.limiteEnStart === start) {
      return new Response(JSON.stringify({ code: 429, message: "Too many requests" }), { status: 400 })
    }
    return new Response(JSON.stringify(padron.slice(start, start + 30)), { status: 200 })
  })
}

/** UN tramo (una invocación de la ruta). */
const sync = (trigger: "cron" | "manual" = "cron", deadline?: number) =>
  syncContacts(config, trigger, { intervaloMs: 0, deadline })

/** Tramos hasta que la pasada cierre, como el loop del workflow. Devuelve todos los resultados. */
async function pasadaCompleta() {
  const tramos = []
  for (let i = 0; i < 50; i++) {
    const r = await sync()
    tramos.push(r)
    if (r.done) return tramos
  }
  throw new Error("la pasada no terminó en 50 tramos")
}
const ultimo = <T,>(xs: T[]) => xs[xs.length - 1]

async function filas() {
  return getDb()
    .select()
    .from(alegraContacts)
    .where(eq(alegraContacts.tenantId, TENANT))
    .orderBy(alegraContacts.alegraId)
}
const activos = async () => (await filas()).filter((f) => f.status === "active").length

async function corridas() {
  return getDb()
    .select()
    .from(alegraContactsSyncLog)
    .where(eq(alegraContactsSyncLog.tenantId, TENANT))
    .orderBy(alegraContactsSyncLog.startedAt)
}

async function ultimaCorrida() {
  const [row] = await getDb()
    .select()
    .from(alegraContactsSyncLog)
    .where(eq(alegraContactsSyncLog.tenantId, TENANT))
    .orderBy(desc(alegraContactsSyncLog.startedAt))
    .limit(1)
  return row
}

beforeEach(async () => {
  await truncateAll()
  await seedTenant(TENANT)
  fetchMock.mockReset()
  starts = []
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("syncContacts por tramos (DB real, Alegra mockeado)", () => {
  it("una pasada de 100 contactos: tramo de 3 páginas, cursor en la bitácora y cierre en el segundo", async () => {
    alegraSirve(padronDe(100))

    const t1 = await sync()
    expect(t1).toEqual({ cuenta: "principal", ok: true, done: false, contactsSynced: 90, totalPasada: 90, markedInactive: 0, requests: 3 })
    // Guardado en el momento, y la pasada abierta con el cursor.
    expect(await activos()).toBe(90)
    expect(await ultimaCorrida()).toMatchObject({ status: "running", contactsSynced: 90, requests: 3 })

    const t2 = await sync()
    expect(t2).toEqual({ cuenta: "principal", ok: true, done: true, contactsSynced: 10, totalPasada: 100, markedInactive: 0, requests: 1 })
    expect(starts).toEqual([0, 30, 60, 90])
    expect(await activos()).toBe(100)

    // Una sola fila de bitácora por pasada, no por tramo.
    const log = await corridas()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ status: "ok", trigger: "cron", contactsSynced: 100, requests: 4, error: null })
    expect(log[0].finishedAt).not.toBeNull()
  })

  it("página exacta de 30 al final: una request más que vuelve vacía y cierra", async () => {
    alegraSirve(padronDe(90))
    const tramos = await pasadaCompleta()
    expect(tramos).toHaveLength(2)
    expect(ultimo(tramos)).toMatchObject({ done: true, contactsSynced: 0, totalPasada: 90, requests: 1 })
  })

  it("upsert idempotente: la misma fila se actualiza y synced_at avanza", async () => {
    alegraSirve([contacto(1, { priceList: { id: 1, name: "Público" } }), contacto(2)])
    await pasadaCompleta()
    const [antes] = await filas()

    alegraSirve([contacto(1, { name: "Cliente 1 renombrado", priceList: { id: 2, name: "Mayorista" } }), contacto(2)])
    await pasadaCompleta()
    const todas = await filas()
    expect(todas).toHaveLength(2)
    const despues = todas.find((f) => f.alegraId === "1")!
    expect(despues.id).toBe(antes.id)
    expect(despues.name).toBe("Cliente 1 renombrado")
    expect(despues.priceListId).toBe("2")
    expect(despues.origen).toBe("sync")
    expect(despues.syncedAt.getTime()).toBeGreaterThan(antes.syncedAt.getTime())
  })

  it("baja soft tras una pasada OK y reactivación cuando vuelve a aparecer", async () => {
    alegraSirve(padronDe(5))
    await pasadaCompleta()

    // 4 de 5 = 80 %: alcanza el umbral, el 5 queda inactive.
    alegraSirve(padronDe(4))
    expect(ultimo(await pasadaCompleta())).toMatchObject({ ok: true, done: true, totalPasada: 4, markedInactive: 1 })
    expect((await filas()).find((f) => f.alegraId === "5")!.status).toBe("inactive")

    alegraSirve(padronDe(5))
    await pasadaCompleta()
    expect((await filas()).find((f) => f.alegraId === "5")!.status).toBe("active")
    expect(await activos()).toBe(5)
  })

  it("las bajas esperan al cierre de la pasada: un tramo intermedio no da de baja nada", async () => {
    alegraSirve(padronDe(100))
    await pasadaCompleta()

    // Desaparecen del 91 al 100: el primer tramo (1–90) no los ve, pero todavía no es el final.
    alegraSirve(padronDe(90))
    expect(await sync()).toMatchObject({ done: false, markedInactive: 0 })
    expect(await activos()).toBe(100)

    expect(await sync()).toMatchObject({ ok: true, done: true, markedInactive: 10 })
    expect(await activos()).toBe(90)
  })

  it("429 de /contacts a mitad de tramo: corta sin reintentar, guarda lo leído y el próximo tramo retoma", async () => {
    alegraSirve(padronDe(100), { limiteEnStart: 30 })
    const t1 = await sync()
    expect(t1).toEqual({
      cuenta: "principal",
      ok: true,
      done: false,
      cortado: "alegra_429",
      contactsSynced: 30,
      totalPasada: 30,
      markedInactive: 0,
      requests: 2,
    })
    expect(starts).toEqual([0, 30])
    expect(await ultimaCorrida()).toMatchObject({ status: "running", contactsSynced: 30, requests: 2, error: null })

    alegraSirve(padronDe(100))
    const resto = await pasadaCompleta()
    expect(ultimo(resto)).toMatchObject({ ok: true, done: true, totalPasada: 100 })
    expect(starts).toEqual([0, 30, 30, 60, 90])
    expect(await corridas()).toMatchObject([{ status: "ok", contactsSynced: 100, requests: 5 }])
  })

  it("pasada que falla a mitad de camino: cero bajas, bitácora en error y la próxima arranca de cero", async () => {
    alegraSirve(padronDe(100))
    await pasadaCompleta()

    alegraSirve(padronDe(100), { fallaEnStart: 60 })
    const r = await sync()
    expect(r).toMatchObject({ ok: false, done: true, markedInactive: 0, totalPasada: 60, error: "alegra_http_500" })
    expect(await activos()).toBe(100)
    expect(await ultimaCorrida()).toMatchObject({ status: "error", error: "alegra_http_500", markedInactive: 0 })

    starts = []
    alegraSirve(padronDe(100))
    await sync()
    expect(starts[0]).toBe(0)
  })

  it("guarda del 80 %: una pasada que ve de menos no marca bajas (corrida_sospechosa)", async () => {
    alegraSirve(padronDe(10))
    await pasadaCompleta()

    alegraSirve(padronDe(7))
    const r = ultimo(await pasadaCompleta())
    expect(r).toMatchObject({ ok: false, done: true, totalPasada: 7, markedInactive: 0, error: "corrida_sospechosa" })
    expect(await activos()).toBe(10)
    expect(await ultimaCorrida()).toMatchObject({ status: "error", error: "corrida_sospechosa" })
  })

  it("la guarda cuenta lo visto en TODA la pasada, no en el último tramo", async () => {
    alegraSirve(padronDe(100))
    await pasadaCompleta()

    // El último tramo ve 5 contactos; la pasada, 95 de 100: pasa la guarda.
    alegraSirve(padronDe(95))
    const tramos = await pasadaCompleta()
    expect(ultimo(tramos)).toMatchObject({ ok: true, contactsSynced: 5, totalPasada: 95, markedInactive: 5 })
  })

  it("deadline vencido: sin_tiempo, sin bajas, sin requests y la pasada sigue abierta", async () => {
    alegraSirve(padronDe(10))
    await pasadaCompleta()

    const r = await sync("cron", Date.now() - 1)
    expect(r).toMatchObject({ ok: true, done: false, cortado: "sin_tiempo", markedInactive: 0, requests: 0 })
    expect(await activos()).toBe(10)
    expect(await ultimaCorrida()).toMatchObject({ status: "running" })
  })

  it("pasada abandonada (más de 8 días sin avanzar): se cierra en error y arranca otra desde cero", async () => {
    alegraSirve(padronDe(100))
    await sync()
    const [vieja] = await corridas()
    const hace9dias = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000)
    await getDb()
      .update(alegraContactsSyncLog)
      .set({ startedAt: hace9dias, finishedAt: hace9dias })
      .where(eq(alegraContactsSyncLog.id, vieja.id))

    starts = []
    const r = await sync()
    expect(r).toMatchObject({ ok: true, done: false, totalPasada: 90 })
    expect(starts).toEqual([0, 30, 60])
    const log = await corridas()
    expect(log).toHaveLength(2)
    expect(log[0]).toMatchObject({ id: vieja.id, status: "error", error: "pasada_abandonada", markedInactive: 0 })
    expect(log[1]).toMatchObject({ status: "running", contactsSynced: 90 })
  })

  it("pasada de la semana pasada que no terminó (menos de 8 días): la retoma en vez de reiniciarla", async () => {
    alegraSirve(padronDe(100))
    await sync()
    const [pasada] = await corridas()
    const semanaPasada = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    await getDb()
      .update(alegraContactsSyncLog)
      .set({ startedAt: semanaPasada, finishedAt: semanaPasada })
      .where(eq(alegraContactsSyncLog.id, pasada.id))

    starts = []
    expect(await sync()).toMatchObject({ ok: true, done: true, totalPasada: 100 })
    expect(starts).toEqual([90])
  })

  it("candado tomado por otra invocación del mismo tenant: se saltea sin tocar Alegra", async () => {
    alegraSirve(padronDe(3))
    const otra = postgres(process.env.DATABASE_URL!, { max: 1 })
    try {
      const r = await otra.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtext(${`alegra_contacts:${TENANT}`}))`
        return sync()
      })
      expect(r).toMatchObject({ ok: true, skipped: true, done: false, requests: 0 })
    } finally {
      await otra.end()
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await ultimaCorrida()).toMatchObject({ status: "skipped", error: "corrida_en_curso" })
    // El salteo no deja una pasada abierta.
    expect((await corridas()).filter((c) => c.status === "running")).toHaveLength(0)
  })

  it("contacto inactivo en Alegra: alegra_status='inactive' pero status='active' (lo vio la pasada)", async () => {
    alegraSirve([contacto(1, { status: "inactive" })])
    await pasadaCompleta()
    const [f] = await filas()
    expect(f.alegraStatus).toBe("inactive")
    expect(f.status).toBe("active")
  })

  it("tenant sin credenciales: skipped y no llama a Alegra", async () => {
    const r = await syncContacts({ ...config, alegraToken: "" }, "manual")
    expect(r).toMatchObject({ ok: true, skipped: true, done: true, error: "sin_credenciales" })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await ultimaCorrida()).toMatchObject({ status: "skipped", trigger: "manual" })
  })

  it("el error registrado no trae datos de contactos aunque Alegra los devuelva en el body", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => {})
    const nombre = "Iluminación Reservada SA"
    const email = "reservado@cliente.example"
    alegraSirve([contacto(1, { name: nombre, email })], {
      fallaEnStart: 0,
      cuerpoError: JSON.stringify({ message: `fallo con ${nombre} <${email}> 20-12345678-9` }),
    })
    const r = await sync()
    const log = await ultimaCorrida()
    const logueado = consola.mock.calls.flat().map(String).join(" ")
    for (const texto of [r.error ?? "", log.error ?? "", logueado]) {
      expect(texto).not.toContain(nombre)
      expect(texto).not.toContain(email)
      expect(texto).not.toContain("12345678")
    }
    expect(log.error).toBe("alegra_http_500")
  })

  it("un alegra_id repetido entre páginas no rompe el upsert", async () => {
    const padron = padronDe(30)
    alegraSirve([...padron, contacto(30, { name: "Cliente 30 bis" })])
    const r = ultimo(await pasadaCompleta())
    expect(r.ok).toBe(true)
    const [f] = await getDb()
      .select()
      .from(alegraContacts)
      .where(and(eq(alegraContacts.tenantId, TENANT), eq(alegraContacts.alegraId, "30")))
    expect(f.name).toBe("Cliente 30 bis")
  })
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe("syncContacts por cuenta (mdp) — el espejo de una cuenta no toca el de la otra", () => {
  const configMdp = { ...config, alegraEmail: "mdp@plataforma.example", alegraToken: "token-mdp" } as unknown as TenantConfig
  const syncMdp = (trigger: "cron" | "manual" = "cron") => syncContacts(configMdp, trigger, { intervaloMs: 0, cuenta: "mdp" })
  const syncPrincipal = () => syncContacts(config, "cron", { intervaloMs: 0 })

  async function pasadaDe(cuenta: "principal" | "mdp") {
    for (let i = 0; i < 50; i++) {
      const r = await (cuenta === "mdp" ? syncMdp() : syncPrincipal())
      if (r.done) return r
    }
    throw new Error("la pasada no terminó en 50 tramos")
  }

  const filasDe = (cuenta: string) =>
    getDb()
      .select()
      .from(alegraContacts)
      .where(and(eq(alegraContacts.tenantId, TENANT), eq(alegraContacts.alegraAccount, cuenta)))
      .orderBy(alegraContacts.alegraId)

  const corridasDe = (cuenta: string) =>
    getDb()
      .select()
      .from(alegraContactsSyncLog)
      .where(and(eq(alegraContactsSyncLog.tenantId, TENANT), eq(alegraContactsSyncLog.alegraAccount, cuenta)))
      .orderBy(alegraContactsSyncLog.startedAt)

  it("sync de 'mdp': 2 filas 'mdp' y las 3 'principal' quedan intactas (incluido synced_at)", async () => {
    alegraSirve(padronDe(3))
    await pasadaDe("principal")
    const antes = await filasDe("principal")
    expect(antes).toHaveLength(3)

    alegraSirve([contacto(101), contacto(102)])
    const r = await pasadaDe("mdp")
    expect(r).toMatchObject({ ok: true, done: true, cuenta: "mdp", totalPasada: 2 })

    expect((await filasDe("mdp")).map((f) => f.alegraId)).toEqual(["101", "102"])
    const despues = await filasDe("principal")
    expect(despues.map((f) => [f.alegraId, f.status, f.syncedAt.getTime()])).toEqual(
      antes.map((f) => [f.alegraId, f.status, f.syncedAt.getTime()]),
    )
    expect((await corridasDe("mdp")).map((c) => c.status)).toEqual(["ok"])
    expect((await corridasDe("principal")).map((c) => c.status)).toEqual(["ok"])
  })

  it("el mismo id 15 en ambas cuentas son dos filas independientes con datos propios", async () => {
    alegraSirve([contacto(15, { name: "Cliente A", email: "a@cliente-a.example" })])
    await pasadaDe("principal")
    alegraSirve([contacto(15, { name: "Cliente B", email: "b@cliente-b.example" })])
    await pasadaDe("mdp")

    const [p] = await filasDe("principal")
    const [m] = await filasDe("mdp")
    expect(p).toMatchObject({ alegraId: "15", name: "Cliente A" })
    expect(m).toMatchObject({ alegraId: "15", name: "Cliente B" })
    expect(p.id).not.toBe(m.id)
  })

  it("un contacto 'principal' que Alegra-MDP no devuelve NO se da de baja al cerrar la pasada de 'mdp'; la baja solo afecta filas 'mdp'", async () => {
    alegraSirve(padronDe(5))
    await pasadaDe("principal")
    alegraSirve(padronDe(5))
    await pasadaDe("mdp")
    alegraSirve(padronDe(4))
    expect(await pasadaDe("mdp")).toMatchObject({ ok: true, markedInactive: 1 })
    expect((await filasDe("mdp")).filter((f) => f.status === "inactive").map((f) => f.alegraId)).toEqual(["5"])
    expect((await filasDe("principal")).every((f) => f.status === "active")).toBe(true)
  })

  it("guarda del 80 % por cuenta: 'mdp' con 100 filas y una pasada de 10 → corrida_sospechosa; 'principal' no se afecta", async () => {
    alegraSirve(padronDe(100))
    await pasadaDe("mdp")
    alegraSirve(padronDe(10))
    await pasadaDe("principal")

    alegraSirve(padronDe(10))
    const r = await pasadaDe("mdp")
    expect(r).toMatchObject({ ok: false, done: true, markedInactive: 0, error: "corrida_sospechosa", cuenta: "mdp" })
    expect((await filasDe("mdp")).filter((f) => f.status === "active")).toHaveLength(100)
    expect((await filasDe("principal")).filter((f) => f.status === "active")).toHaveLength(10)
    expect((await corridasDe("mdp")).at(-1)).toMatchObject({ status: "error", error: "corrida_sospechosa" })
    expect((await corridasDe("principal")).at(-1)).toMatchObject({ status: "ok" })
  })

  it("candado por cuenta: con el de 'mdp' tomado, 'mdp' se saltea y 'principal' avanza", async () => {
    alegraSirve(padronDe(3))
    const otra = postgres(process.env.DATABASE_URL!, { max: 1 })
    try {
      const [mdp, principal] = await otra.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtext(${`alegra_contacts:${TENANT}:mdp`}))`
        return [await syncMdp(), await syncPrincipal()]
      })
      expect(mdp).toMatchObject({ ok: true, skipped: true, done: false, error: "corrida_en_curso", cuenta: "mdp" })
      expect(principal).toMatchObject({ ok: true, done: true, cuenta: "principal", totalPasada: 3 })
    } finally {
      await otra.end()
    }
    expect((await corridasDe("mdp")).map((c) => [c.status, c.error])).toEqual([["skipped", "corrida_en_curso"]])
  })

  it("la clave del candado de 'principal' sigue siendo `alegra_contacts:<tenant>` (no se pisa con la de 'mdp')", async () => {
    alegraSirve(padronDe(3))
    const otra = postgres(process.env.DATABASE_URL!, { max: 1 })
    try {
      const [principal, mdp] = await otra.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtext(${`alegra_contacts:${TENANT}`}))`
        return [await syncPrincipal(), await syncMdp()]
      })
      expect(principal).toMatchObject({ skipped: true, error: "corrida_en_curso", cuenta: "principal" })
      expect(mdp).toMatchObject({ ok: true, done: true, cuenta: "mdp" })
    } finally {
      await otra.end()
    }
  })

  it("cuenta sin credenciales: salteo 'sin_credenciales' registrado en ESA cuenta", async () => {
    const r = await syncContacts({ ...config, alegraToken: "" }, "manual", { cuenta: "mdp" })
    expect(r).toMatchObject({ ok: true, skipped: true, done: true, error: "sin_credenciales", cuenta: "mdp" })
    expect(fetchMock).not.toHaveBeenCalled()
    expect((await corridasDe("mdp")).map((c) => c.error)).toEqual(["sin_credenciales"])
    expect(await corridasDe("principal")).toHaveLength(0)
  })

  it("las pasadas en curso son independientes: el cursor de 'mdp' no se mezcla con el de 'principal'", async () => {
    alegraSirve(padronDe(100))
    expect(await syncMdp()).toMatchObject({ done: false, totalPasada: 90, cuenta: "mdp" })
    starts = []
    expect(await syncPrincipal()).toMatchObject({ done: false, totalPasada: 90, cuenta: "principal" })
    expect(starts).toEqual([0, 30, 60])
    expect((await corridasDe("mdp")).filter((c) => c.status === "running")).toHaveLength(1)
    expect((await corridasDe("principal")).filter((c) => c.status === "running")).toHaveLength(1)
  })
})
