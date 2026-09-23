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

/** Sirve `padron` paginado por ?start=; `fallaEnStart` devuelve 500 en esa página. */
function alegraSirve(padron: Raw[], opts: { fallaEnStart?: number; cuerpoError?: string } = {}) {
  fetchMock.mockImplementation(async (url: string) => {
    const start = Number(new URL(url).searchParams.get("start"))
    if (opts.fallaEnStart === start) return new Response(opts.cuerpoError ?? "boom", { status: 500 })
    return new Response(JSON.stringify(padron.slice(start, start + 30)), { status: 200 })
  })
}

const sync = (trigger: "cron" | "manual" = "cron", deadline?: number) =>
  syncContacts(config, trigger, { intervaloMs: 0, deadline })

async function filas() {
  return getDb()
    .select()
    .from(alegraContacts)
    .where(eq(alegraContacts.tenantId, TENANT))
    .orderBy(alegraContacts.alegraId)
}
const activos = async () => (await filas()).filter((f) => f.status === "active").length

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
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("syncContacts (DB real, Alegra mockeado)", () => {
  it("primera corrida: inserta todo, registra requests y deja la bitácora en ok", async () => {
    alegraSirve(padronDe(75))
    const r = await sync()
    expect(r).toEqual({ ok: true, contactsSynced: 75, markedInactive: 0, requests: 3 })
    expect(await activos()).toBe(75)
    const log = await ultimaCorrida()
    expect(log).toMatchObject({ status: "ok", trigger: "cron", contactsSynced: 75, requests: 3, error: null })
    expect(log.finishedAt).not.toBeNull()
  })

  it("upsert idempotente: la misma fila se actualiza y synced_at avanza", async () => {
    alegraSirve([contacto(1, { priceList: { id: 1, name: "Público" } }), contacto(2)])
    await sync()
    const [antes] = await filas()

    alegraSirve([contacto(1, { name: "Cliente 1 renombrado", priceList: { id: 2, name: "Mayorista" } }), contacto(2)])
    await sync()
    const todas = await filas()
    expect(todas).toHaveLength(2)
    const despues = todas.find((f) => f.alegraId === "1")!
    expect(despues.id).toBe(antes.id)
    expect(despues.name).toBe("Cliente 1 renombrado")
    expect(despues.priceListId).toBe("2")
    expect(despues.origen).toBe("sync")
    expect(despues.syncedAt.getTime()).toBeGreaterThan(antes.syncedAt.getTime())
  })

  it("baja soft tras una corrida OK y reactivación cuando vuelve a aparecer", async () => {
    alegraSirve(padronDe(5))
    await sync()

    // 4 de 5 = 80 %: alcanza el umbral, el 5 queda inactive.
    alegraSirve(padronDe(4))
    const r = await sync()
    expect(r).toMatchObject({ ok: true, contactsSynced: 4, markedInactive: 1 })
    expect((await filas()).find((f) => f.alegraId === "5")!.status).toBe("inactive")

    alegraSirve(padronDe(5))
    await sync()
    expect((await filas()).find((f) => f.alegraId === "5")!.status).toBe("active")
    expect(await activos()).toBe(5)
  })

  it("corrida que falla a mitad de camino (40 %): cero bajas y bitácora en error", async () => {
    alegraSirve(padronDe(100))
    await sync()

    alegraSirve(padronDe(100), { fallaEnStart: 60 })
    const r = await sync()
    expect(r).toMatchObject({ ok: false, markedInactive: 0, error: "alegra_http_500" })
    expect(await activos()).toBe(100)
    expect(await ultimaCorrida()).toMatchObject({ status: "error", error: "alegra_http_500", markedInactive: 0 })
  })

  it("guarda del 80 %: una corrida que ve de menos no marca bajas (corrida_sospechosa)", async () => {
    alegraSirve(padronDe(10))
    await sync()

    alegraSirve(padronDe(7))
    const r = await sync()
    expect(r).toMatchObject({ ok: false, contactsSynced: 7, markedInactive: 0, error: "corrida_sospechosa" })
    expect(await activos()).toBe(10)
    expect(await ultimaCorrida()).toMatchObject({ status: "error", error: "corrida_sospechosa" })
  })

  it("deadline vencido: sin_tiempo, sin bajas y sin requests", async () => {
    alegraSirve(padronDe(10))
    await sync()

    const r = await sync("cron", Date.now() - 1)
    expect(r).toMatchObject({ ok: false, error: "sin_tiempo", markedInactive: 0, requests: 0 })
    expect(await activos()).toBe(10)
  })

  it("candado tomado por otra corrida del mismo tenant: se saltea sin tocar Alegra", async () => {
    alegraSirve(padronDe(3))
    const otra = postgres(process.env.DATABASE_URL!, { max: 1 })
    try {
      const r = await otra.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtext(${`alegra_contacts:${TENANT}`}))`
        return sync()
      })
      expect(r).toMatchObject({ ok: true, skipped: true, requests: 0 })
    } finally {
      await otra.end()
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await ultimaCorrida()).toMatchObject({ status: "skipped", error: "corrida_en_curso" })
  })

  it("contacto inactivo en Alegra: alegra_status='inactive' pero status='active' (lo vio la corrida)", async () => {
    alegraSirve([contacto(1, { status: "inactive" })])
    await sync()
    const [f] = await filas()
    expect(f.alegraStatus).toBe("inactive")
    expect(f.status).toBe("active")
  })

  it("tenant sin credenciales: skipped y no llama a Alegra", async () => {
    const r = await syncContacts({ ...config, alegraToken: "" }, "manual")
    expect(r).toMatchObject({ ok: true, skipped: true, error: "sin_credenciales" })
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
    const r = await sync()
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
