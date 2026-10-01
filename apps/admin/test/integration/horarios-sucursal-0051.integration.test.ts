import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { and, eq, sql as dsql } from "drizzle-orm"
import { getDb } from "@/db"
import { sucursales, tenants } from "@/db/schema"
import { crearSucursal, listarSucursales } from "@/lib/sucursales-repo"
import { copiarHorario, guardarHorario, leerHorario, listarSucursalesActivas } from "@/lib/horarios-repo"
import { emptySchedule, type ScheduleException, type WeeklySchedule } from "@/lib/schedule"
import { TEST_DATABASE_URL, assertLocalTestDb } from "./db-url"
import { seedTenant, truncateAll } from "./helpers"

/**
 * Migración 0051 (change `horarios-por-sucursal`, rebanada A) contra la base real de test:
 * columnas y defaults, backfill desde `tenants`, GRANT por columna a `shop_app`, el repo de
 * horarios (aislamiento de tenant, copiar) y el endpoint interno business-hours.
 * Datos inventados: tenants `tenant-a` / `tenant-b`, sedes ficticias, dominios `.example`.
 */

const MIGRACION_0041 = fileURLToPath(new URL("../../drizzle/0041_sucursales_zonas.sql", import.meta.url))
const MIGRACION_0051 = fileURLToPath(new URL("../../drizzle/0051_sucursales_horario.sql", import.meta.url))

const A = "tenant-a"
const B = "tenant-b"
const SECRET = "secreto-interno-de-test"

const semana = (open: string, close: string, dias: (keyof WeeklySchedule)[]): WeeklySchedule => {
  const s = emptySchedule()
  for (const d of dias) s[d] = [{ open, close }]
  return s
}
const LV = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const
const HORARIO_EMPRESA = semana("08:00", "20:00", [...LV])
const HORARIO_NORTE = semana("09:00", "18:00", [...LV])
const HORARIO_SUR = semana("10:00", "20:00", ["monday", "saturday"])
const FERIADO: ScheduleException = { type: "closed", date: "2026-10-12", to: null, reason: "feriado" }
const NAVIDAD: ScheduleException = { type: "closed", date: "2026-12-25", to: null, reason: "Navidad" }

const alta = (tenant: string, slug: string, extra: Record<string, unknown> = {}) =>
  crearSucursal(tenant, { slug, nombre: `Sede ${slug}`, ciudad: `Ciudad ${slug}`, ...extra })

async function crudo(tenant: string, slug: string) {
  const [f] = await getDb()
    .select({ schedule: sucursales.schedule, ex: sucursales.scheduleExceptions, horario: sucursales.horario })
    .from(sucursales)
    .where(and(eq(sucursales.tenantId, tenant), eq(sucursales.slug, slug)))
  return f
}

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
  await seedTenant(B)
})
afterAll(async () => {
  await truncateAll()
})

describe("0051: defaults y backfill", () => {
  it("una sucursal nueva queda sin horario configurado ({} y [])", async () => {
    await alta(A, "norte")
    const f = await crudo(A, "norte")
    expect(f.schedule).toEqual({})
    expect(f.ex).toEqual([])
  })

  it("el UPDATE de backfill copia horario y excepciones del tenant a cada sucursal, sin tocar `horario` ni tenants", async () => {
    await getDb()
      .update(tenants)
      .set({ schedule: HORARIO_EMPRESA, scheduleExceptions: [NAVIDAD] })
      .where(eq(tenants.id, A))
    await alta(A, "norte")
    await getDb().update(sucursales).set({ horario: "Texto libre legado" }).where(eq(sucursales.slug, "norte"))
    await alta(A, "sur")
    await alta(B, "unica")
    // Las sucursales se crearon DESPUÉS de migrar (defaults); se vuelve a correr el UPDATE tal
    // cual está en el .sql, que es lo que hizo la migración sobre las filas preexistentes.
    const upd = readFileSync(MIGRACION_0051, "utf8")
      .split("--> statement-breakpoint")
      .find((p) => /^\s*UPDATE "sucursales"/m.test(p))
    if (!upd) throw new Error("0051: no encontré el UPDATE de backfill")
    await getDb().execute(dsql.raw(upd))

    for (const slug of ["norte", "sur"]) {
      const f = await crudo(A, slug)
      expect(f.schedule).toEqual(HORARIO_EMPRESA)
      expect(f.ex).toEqual([NAVIDAD])
    }
    // El tenant B no tiene horario propio: su sucursal hereda el vacío de B, no el de A.
    expect((await crudo(B, "unica")).schedule).toEqual({})
    // `horario` legado y tenants.* intactos.
    expect((await crudo(A, "norte")).horario).toBe("Texto libre legado")
    const [t] = await getDb().select({ s: tenants.schedule, e: tenants.scheduleExceptions }).from(tenants).where(eq(tenants.id, A))
    expect(t.s).toEqual(HORARIO_EMPRESA)
    expect(t.e).toEqual([NAVIDAD])
  })
})

describe("0051: GRANT por columna a shop_app", () => {
  let sql: postgres.Sql
  let rolCreadoAca = false

  async function comoShopApp(stmt: string): Promise<{ ok: true } | { ok: false; code: string }> {
    let r: { ok: true } | { ok: false; code: string } | null = null
    const ROLLBACK = new Error("rollback")
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE shop_app")
        try {
          await tx.unsafe(stmt)
          r = { ok: true }
        } catch (e) {
          r = { ok: false, code: (e as { code?: string }).code ?? "?" }
        }
        throw ROLLBACK
      })
    } catch (e) {
      if (e !== ROLLBACK) throw e
    }
    if (!r) throw new Error("comoShopApp: sin resultado")
    return r
  }

  const bloque = (archivo: string) => {
    const partes = readFileSync(archivo, "utf8").split("--> statement-breakpoint")
    const b = partes[partes.length - 1]
    if (!/DO \$\$/.test(b)) throw new Error(`${archivo}: no encontré el bloque DO $$ de los GRANTs`)
    return b
  }

  beforeAll(async () => {
    assertLocalTestDb(TEST_DATABASE_URL)
    sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })
    const existe = await sql`SELECT 1 FROM pg_roles WHERE rolname = 'shop_app'`
    if (existe.length === 0) {
      // Sin el rol el bloque condicional no concede nada y NO falla (como al migrar crm_test).
      await sql.unsafe(bloque(MIGRACION_0051))
      await sql.unsafe("CREATE ROLE shop_app NOLOGIN")
      rolCreadoAca = true
    }
    await sql.unsafe(bloque(MIGRACION_0041))
    await sql.unsafe(bloque(MIGRACION_0051))
  })
  afterAll(async () => {
    if (!sql) return
    if (rolCreadoAca) {
      await sql.unsafe("DROP OWNED BY shop_app")
      await sql.unsafe("DROP ROLE shop_app")
    }
    await sql.end()
  })

  it("shop_app lee schedule y schedule_exceptions (y sigue leyendo horario)", async () => {
    expect(await comoShopApp(`SELECT "schedule", "schedule_exceptions", "horario" FROM public.sucursales`)).toEqual({ ok: true })
  })
  it("no concede nada más: id, cuenta_alegra_id y escrituras siguen negadas", async () => {
    expect(await comoShopApp(`SELECT "id" FROM public.sucursales`)).toEqual({ ok: false, code: "42501" })
    expect(await comoShopApp(`SELECT "cuenta_alegra_id" FROM public.sucursales`)).toEqual({ ok: false, code: "42501" })
    expect(await comoShopApp(`UPDATE public.sucursales SET "schedule" = '{}'::jsonb`)).toEqual({ ok: false, code: "42501" })
  })
})

describe("horarios-repo", () => {
  it("guardar por sucursal no toca tenants ni las otras sucursales; guardar sin slug solo toca tenants", async () => {
    await alta(A, "norte")
    await alta(A, "sur")
    expect(await guardarHorario(A, "sur", { schedule: HORARIO_SUR, exceptions: [FERIADO] })).toEqual({ kind: "ok" })

    const sur = await leerHorario(A, "sur")
    expect(sur).toEqual({ kind: "ok", schedule: HORARIO_SUR, exceptions: [FERIADO] })
    expect((await crudo(A, "norte")).schedule).toEqual({})
    const empresa = await leerHorario(A, null)
    expect(empresa).toMatchObject({ kind: "ok", exceptions: [] })

    await guardarHorario(A, null, { schedule: HORARIO_EMPRESA, exceptions: [NAVIDAD] })
    expect((await crudo(A, "sur")).schedule).toEqual(HORARIO_SUR)
    expect(await leerHorario(A, null)).toEqual({ kind: "ok", schedule: HORARIO_EMPRESA, exceptions: [NAVIDAD] })
  })

  it("un slug de otro tenant se comporta como inexistente: no lee ni escribe", async () => {
    await alta(B, "ajena")
    expect(await leerHorario(A, "ajena")).toEqual({ kind: "not_found" })
    expect(await guardarHorario(A, "ajena", { schedule: HORARIO_SUR, exceptions: [] })).toEqual({ kind: "not_found" })
    expect((await crudo(B, "ajena")).schedule).toEqual({})
  })

  it("listarSucursalesActivas excluye las dadas de baja y filtra por tenant", async () => {
    await alta(A, "norte")
    await alta(A, "sur")
    await alta(A, "vieja", { activa: false })
    await alta(B, "ajena")
    const activas = await listarSucursalesActivas(A)
    expect(activas.map((s) => s.slug).sort()).toEqual(["norte", "sur"])
  })

  describe("copiar", () => {
    beforeEach(async () => {
      await alta(A, "norte")
      await alta(A, "sur")
      await alta(A, "este")
      await guardarHorario(A, "norte", { schedule: HORARIO_NORTE, exceptions: [FERIADO] })
      await guardarHorario(A, "sur", { schedule: HORARIO_SUR, exceptions: [NAVIDAD] })
    })

    it("excepciones: reemplaza SOLO las excepciones de los destinos y deja el horario semanal", async () => {
      const r = await copiarHorario(A, { desde: "norte", hacia: "todas", que: "excepciones" })
      expect(r).toMatchObject({ kind: "ok" })
      const sur = await crudo(A, "sur")
      expect(sur.ex).toEqual([FERIADO])
      expect(sur.schedule).toEqual(HORARIO_SUR)
      expect((await crudo(A, "este")).ex).toEqual([FERIADO])
    })

    it("horario: reemplaza solo el semanal; todo: ambos", async () => {
      await copiarHorario(A, { desde: "norte", hacia: ["sur"], que: "horario" })
      let sur = await crudo(A, "sur")
      expect(sur.schedule).toEqual(HORARIO_NORTE)
      expect(sur.ex).toEqual([NAVIDAD])
      await guardarHorario(A, "norte", { schedule: HORARIO_NORTE, exceptions: [FERIADO, NAVIDAD] })
      await copiarHorario(A, { desde: "norte", hacia: ["sur", "este"], que: "todo" })
      sur = await crudo(A, "sur")
      expect(sur.ex).toEqual([FERIADO, NAVIDAD])
      expect((await crudo(A, "este")).schedule).toEqual(HORARIO_NORTE)
    })

    it("la copia no toca la sucursal de origen ni tenants", async () => {
      await copiarHorario(A, { desde: "norte", hacia: "todas", que: "todo" })
      expect(await leerHorario(A, "norte")).toEqual({ kind: "ok", schedule: HORARIO_NORTE, exceptions: [FERIADO] })
      const [t] = await getDb().select({ s: tenants.schedule }).from(tenants).where(eq(tenants.id, A))
      expect(t.s).toEqual({})
    })

    it("un destino de otro tenant → not_found y NO se escribe nada (ni en los propios)", async () => {
      await alta(B, "ajena")
      const r = await copiarHorario(A, { desde: "norte", hacia: ["sur", "ajena"], que: "todo" })
      expect(r).toEqual({ kind: "not_found" })
      expect((await crudo(A, "sur")).schedule).toEqual(HORARIO_SUR)
      expect((await crudo(B, "ajena")).schedule).toEqual({})
    })

    it("origen de otro tenant → not_found; origen como destino o sin destinos → invalid", async () => {
      await alta(B, "ajena")
      expect(await copiarHorario(A, { desde: "ajena", hacia: "todas", que: "todo" })).toEqual({ kind: "not_found" })
      expect(await copiarHorario(A, { desde: "norte", hacia: ["norte"], que: "todo" })).toMatchObject({ kind: "invalid" })
      expect(await copiarHorario(A, { desde: "norte", hacia: [], que: "todo" })).toMatchObject({ kind: "invalid" })
    })

    it("'todas' copia solo a las ACTIVAS; con una sola sucursal activa → invalid", async () => {
      await alta(A, "inactiva", { activa: false })
      const r = await copiarHorario(A, { desde: "norte", hacia: "todas", que: "horario" })
      expect(r).toMatchObject({ kind: "ok" })
      if (r.kind === "ok") expect(r.destinos.sort()).toEqual(["este", "sur"])
      expect((await crudo(A, "inactiva")).schedule).toEqual({})
      await alta(B, "unica")
      expect(await copiarHorario(B, { desde: "unica", hacia: "todas", que: "todo" })).toMatchObject({ kind: "invalid" })
    })
  })
})

describe("GET /api/internal/business-hours (DB real)", () => {
  const pedir = async (tenantId: string) => {
    vi.stubEnv("INTERNAL_SECRET", SECRET)
    const { GET } = await import("@/app/api/internal/business-hours/route")
    const res = await GET(
      new Request(`http://admin.test/api/internal/business-hours?tenantId=${tenantId}`, {
        headers: { authorization: `Bearer ${SECRET}` },
      }),
    )
    return { status: res.status, body: await res.json() }
  }

  it("sin sucursales: legado = tenants.* y sucursales []", async () => {
    await getDb().update(tenants).set({ schedule: HORARIO_EMPRESA, scheduleExceptions: [NAVIDAD] }).where(eq(tenants.id, A))
    const { status, body } = await pedir(`ai-${A}`)
    expect(status).toBe(200)
    expect(body.sucursales).toEqual([])
    expect(body.schedule.monday).toEqual([{ open: "08:00", close: "20:00" }])
    expect(body.notes).toBe("Cerrado el 25/12/2026 (Navidad).")
  })

  it("dos sucursales + una inactiva: legado de la predeterminada y solo las activas en sucursales[]", async () => {
    await getDb().update(tenants).set({ schedule: HORARIO_EMPRESA }).where(eq(tenants.id, A))
    await alta(A, "norte", { predeterminada: true, orden: 0 })
    await alta(A, "sur", { orden: 1 })
    await alta(A, "vieja", { activa: false, orden: 2 })
    await guardarHorario(A, "norte", { schedule: HORARIO_NORTE, exceptions: [] })
    await guardarHorario(A, "sur", { schedule: HORARIO_SUR, exceptions: [FERIADO] })
    await guardarHorario(A, "vieja", { schedule: HORARIO_SUR, exceptions: [] })

    const { body } = await pedir(`ai-${A}`)
    expect(body.sucursales.map((s: { slug: string }) => s.slug)).toEqual(["norte", "sur"])
    expect(body.schedule.monday).toEqual([{ open: "09:00", close: "18:00" }])
    expect(body.notes).toBeNull()
    expect(body.sucursales[1]).toMatchObject({ slug: "sur", nombre: "Sede sur", ciudad: "Ciudad sur", predeterminada: false })
    expect(body.sucursales[1].notes).toBe("Cerrado el 12/10/2026 (feriado).")
    expect(JSON.stringify(body)).not.toContain("abierto_ahora")
  })

  it("aislamiento: las sucursales de otro tenant no aparecen", async () => {
    await alta(B, "ajena", { predeterminada: true })
    const { body } = await pedir(`ai-${A}`)
    expect(body.sucursales).toEqual([])
  })

  it("tenant inexistente: respuesta vacía como hoy + sucursales []", async () => {
    const { status, body } = await pedir("ai-no-existe")
    expect(status).toBe(200)
    expect(body.notes).toBeNull()
    expect(body.sucursales).toEqual([])
    expect(Object.keys(body.schedule)).toHaveLength(7)
  })

  it("auth: sin llave → 401; sin tenantId → 400", async () => {
    vi.stubEnv("INTERNAL_SECRET", SECRET)
    const { GET } = await import("@/app/api/internal/business-hours/route")
    expect((await GET(new Request("http://admin.test/api/internal/business-hours?tenantId=x"))).status).toBe(401)
    expect(
      (
        await GET(
          new Request("http://admin.test/api/internal/business-hours", { headers: { authorization: `Bearer ${SECRET}` } }),
        )
      ).status,
    ).toBe(400)
  })
})

// Usa listarSucursales para detectar que `horario` sigue siendo parte de la fila (deprecado, no borrado).
describe("compatibilidad", () => {
  it("la columna `horario` sigue existiendo y se conserva", async () => {
    await getDb().insert(sucursales).values({ tenantId: A, slug: "norte", nombre: "Sede norte", horario: "Lun a Vie 9 a 18" })
    const filas = await listarSucursales(A)
    expect(filas[0].horario).toBe("Lun a Vie 9 a 18")
  })
})
