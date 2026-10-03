import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { correoCasillaAccesos, correoCasillas, correoEventos, correoHilos } from "@/db/schema"
import {
  borrarEvento,
  casillaPorInbox,
  contarNoLeidos,
  contarNoLeidosPorCasilla,
  destinatariosCasilla,
  limpiarEventosViejos,
  marcarHilo,
  reconciliarHilos,
  registrarEvento,
  upsertCasilla,
  upsertHilo,
} from "@/lib/correo-repo"
import { seedOperator, seedTenant, truncateAll } from "./helpers"

/**
 * Espejo mínimo del correo (change `correo-en-crm`, R1) contra la base real de test con las
 * migraciones reales (0060). Datos inventados: dominios `.example`, ids ficticios.
 */

const A = "tenant-a"
const B = "tenant-b"

beforeEach(async () => {
  await truncateAll()
  await seedTenant(A)
  await seedTenant(B)
})
afterAll(async () => {
  await truncateAll()
})

describe("casillas", () => {
  it("upsert por (tenant, inbox): no duplica, refresca el email y NO pisa nombre ni activa", async () => {
    const c1 = await upsertCasilla(A, { resendInboxId: "inbox_1", email: "ventas@cliente.example" })
    expect(c1?.nombre).toBe("ventas@cliente.example")
    await getDb().update(correoCasillas).set({ nombre: "Ventas", activa: false }).where(eq(correoCasillas.id, c1!.id))

    const c2 = await upsertCasilla(A, { resendInboxId: "inbox_1", email: "ventas2@cliente.example", nombre: "Otro", activa: true })
    expect(c2?.id).toBe(c1!.id)
    expect(c2).toMatchObject({ email: "ventas2@cliente.example", nombre: "Ventas", activa: false })
    const todas = await getDb().select().from(correoCasillas)
    expect(todas).toHaveLength(1)
  })

  it("una inbox de otro tenant no se pisa ni se roba", async () => {
    await upsertCasilla(A, { resendInboxId: "inbox_1", email: "ventas@cliente.example" })
    const robo = await upsertCasilla(B, { resendInboxId: "inbox_1", email: "otro@cliente.example" })
    expect(robo).toBeNull()
    const c = await casillaPorInbox("inbox_1")
    expect(c).toMatchObject({ tenantId: A, email: "ventas@cliente.example" })
  })

  it("casillaPorInbox devuelve null si no existe", async () => {
    expect(await casillaPorInbox("nada")).toBeNull()
  })
})

describe("hilos", () => {
  it("upsert no duplica por (casilla, thread)", async () => {
    const c = (await upsertCasilla(A, { resendInboxId: "inbox_1", email: "ventas@cliente.example" }))!
    await upsertHilo(c.id, "thread_1", { leido: false })
    await upsertHilo(c.id, "thread_1", { leido: false })
    expect(await getDb().select().from(correoHilos)).toHaveLength(1)
  })

  it("last_event_at no retrocede y un evento viejo no pisa el estado", async () => {
    const c = (await upsertCasilla(A, { resendInboxId: "inbox_1", email: "ventas@cliente.example" }))!
    const t2 = new Date("2026-09-30T12:00:00Z")
    const t1 = new Date("2026-09-30T10:00:00Z")
    await upsertHilo(c.id, "thread_1", { folder: "archive", leido: true, eventoAt: t2 })
    const h = await upsertHilo(c.id, "thread_1", { folder: "inbox", leido: false, eventoAt: t1 })
    expect(h.ultimoEventoAt.getTime()).toBe(t2.getTime())
    expect(h).toMatchObject({ folder: "archive", leido: true })
  })

  it("un evento más nuevo sí actualiza carpeta y leído", async () => {
    const c = (await upsertCasilla(A, { resendInboxId: "inbox_1", email: "ventas@cliente.example" }))!
    await upsertHilo(c.id, "thread_1", { folder: "inbox", leido: false, eventoAt: new Date("2026-09-30T10:00:00Z") })
    const h = await upsertHilo(c.id, "thread_1", { folder: "trash", leido: true, eventoAt: new Date("2026-09-30T11:00:00Z") })
    expect(h).toMatchObject({ folder: "trash", leido: true })
  })

  it("solo toca lo informado (folder sin leido deja leido como estaba)", async () => {
    const c = (await upsertCasilla(A, { resendInboxId: "inbox_1", email: "ventas@cliente.example" }))!
    await upsertHilo(c.id, "thread_1", { leido: true, eventoAt: new Date("2026-09-30T10:00:00Z") })
    const h = await upsertHilo(c.id, "thread_1", { folder: "spam", eventoAt: new Date("2026-09-30T11:00:00Z") })
    expect(h).toMatchObject({ folder: "spam", leido: true })
  })

  it("el mismo thread en dos casillas distintas son dos filas", async () => {
    const c1 = (await upsertCasilla(A, { resendInboxId: "inbox_1", email: "a@cliente.example" }))!
    const c2 = (await upsertCasilla(A, { resendInboxId: "inbox_2", email: "b@cliente.example" }))!
    await upsertHilo(c1.id, "thread_1")
    await upsertHilo(c2.id, "thread_1")
    expect(await getDb().select().from(correoHilos)).toHaveLength(2)
  })
})

describe("eventos (idempotencia)", () => {
  it("registrarEvento es true la primera vez y false en un replay", async () => {
    expect(await registrarEvento("msg_1")).toBe(true)
    expect(await registrarEvento("msg_1")).toBe(false)
    expect(await getDb().select().from(correoEventos)).toHaveLength(1)
  })

  it("borrarEvento permite reprocesar", async () => {
    await registrarEvento("msg_1")
    await borrarEvento("msg_1")
    expect(await registrarEvento("msg_1")).toBe(true)
  })

  it("limpiarEventosViejos borra solo los de más de N días", async () => {
    await registrarEvento("viejo")
    await registrarEvento("nuevo")
    await getDb().execute(sql`update correo_eventos set recibido_at = now() - interval '40 days' where svix_id = 'viejo'`)
    expect(await limpiarEventosViejos(30)).toBe(1)
    const restan = await getDb().select().from(correoEventos)
    expect(restan.map((e) => e.svixId)).toEqual(["nuevo"])
  })
})

describe("contarNoLeidos", () => {
  it("cuenta solo no leídos de Recibidos de las casillas pedidas", async () => {
    const a = (await upsertCasilla(A, { resendInboxId: "inbox_a", email: "a@cliente.example" }))!
    const b = (await upsertCasilla(A, { resendInboxId: "inbox_b", email: "b@cliente.example" }))!
    for (const t of ["t1", "t2", "t3"]) await upsertHilo(a.id, t, { folder: "inbox", leido: false })
    await upsertHilo(a.id, "t4", { folder: "inbox", leido: true })
    await upsertHilo(a.id, "t5", { folder: "archive", leido: false })
    for (const t of ["t1", "t2", "t3", "t4", "t5"]) await upsertHilo(b.id, t, { folder: "inbox", leido: false })

    expect(await contarNoLeidos([a.id])).toBe(3)
    expect(await contarNoLeidos([a.id, b.id])).toBe(8)
    expect(await contarNoLeidos([])).toBe(0)
  })
})

describe("lectura (R4): conteo por casilla y reconciliación del listado", () => {
  it("contarNoLeidosPorCasilla agrupa los no leídos de Recibidos por casilla", async () => {
    const a = (await upsertCasilla(A, { resendInboxId: "inbox_a", email: "a@cliente.example" }))!
    const b = (await upsertCasilla(A, { resendInboxId: "inbox_b", email: "b@cliente.example" }))!
    for (const t of ["t1", "t2"]) await upsertHilo(a.id, t, { folder: "inbox", leido: false })
    await upsertHilo(a.id, "t3", { folder: "inbox", leido: true })
    await upsertHilo(b.id, "t1", { folder: "inbox", leido: false })
    await upsertHilo(b.id, "t2", { folder: "trash", leido: false })
    expect(await contarNoLeidosPorCasilla([a.id, b.id])).toEqual({ [a.id]: 2, [b.id]: 1 })
    expect(await contarNoLeidosPorCasilla([])).toEqual({})
  })

  it("reconciliarHilos crea los hilos que el webhook no vio y no pisa un estado más nuevo", async () => {
    const c = (await upsertCasilla(A, { resendInboxId: "inbox_a", email: "a@cliente.example" }))!
    // Hilo conocido por el webhook, ya leído, con un evento reciente.
    await upsertHilo(c.id, "t_vivo", { folder: "inbox", leido: true, eventoAt: new Date("2026-10-03T12:00:00Z") })
    await reconciliarHilos(c.id, "inbox", [
      { threadId: "t_nuevo", leido: false, recibidoEn: new Date("2026-10-01T10:00:00Z") },
      // Resend lo trae viejo y sin leer: el espejo más nuevo manda.
      { threadId: "t_vivo", leido: false, recibidoEn: new Date("2026-10-01T10:00:00Z") },
    ])
    const filas = await getDb().select().from(correoHilos).where(eq(correoHilos.casillaId, c.id))
    const por = Object.fromEntries(filas.map((f) => [f.resendThreadId, f]))
    expect(por.t_nuevo).toMatchObject({ folder: "inbox", leido: false })
    expect(por.t_vivo).toMatchObject({ folder: "inbox", leido: true })
    expect(await contarNoLeidos([c.id])).toBe(1)
  })

  it("reconciliarHilos corrige un hilo viejo del espejo con el estado de Resend si este es más nuevo", async () => {
    const c = (await upsertCasilla(A, { resendInboxId: "inbox_a", email: "a@cliente.example" }))!
    await upsertHilo(c.id, "t1", { folder: "inbox", leido: false, eventoAt: new Date("2026-09-01T00:00:00Z") })
    await reconciliarHilos(c.id, "archive", [{ threadId: "t1", leido: true, recibidoEn: new Date("2026-10-02T00:00:00Z") }])
    const [f] = await getDb().select().from(correoHilos).where(eq(correoHilos.casillaId, c.id))
    expect(f).toMatchObject({ folder: "archive", leido: true })
  })
})

describe("marcarHilo (PATCH propio de leído/carpeta)", () => {
  it("solo toca lo informado: mover de carpeta no cambia leído, marcar leído no cambia carpeta", async () => {
    const c = (await upsertCasilla(A, { resendInboxId: "inbox_a", email: "a@cliente.example" }))!
    await upsertHilo(c.id, "t1", { folder: "inbox", leido: false })
    await marcarHilo(c.id, "t1", { carpeta: "archive" })
    let [f] = await getDb().select().from(correoHilos).where(eq(correoHilos.casillaId, c.id))
    expect(f).toMatchObject({ folder: "archive", leido: false })
    await marcarHilo(c.id, "t1", { leido: true })
    ;[f] = await getDb().select().from(correoHilos).where(eq(correoHilos.casillaId, c.id))
    expect(f).toMatchObject({ folder: "archive", leido: true })
  })

  it("un hilo que el espejo no conocía se crea leído (lo está tocando un operador) y no infla el badge", async () => {
    const c = (await upsertCasilla(A, { resendInboxId: "inbox_a", email: "a@cliente.example" }))!
    await marcarHilo(c.id, "t_nuevo", { carpeta: "trash" })
    await marcarHilo(c.id, "t_nuevo2", { leido: true })
    expect(await contarNoLeidos([c.id])).toBe(0)
    expect(await getDb().select().from(correoHilos)).toHaveLength(2)
  })

  it("marcar no leído un hilo en Recibidos sube el contador", async () => {
    const c = (await upsertCasilla(A, { resendInboxId: "inbox_a", email: "a@cliente.example" }))!
    await upsertHilo(c.id, "t1", { folder: "inbox", leido: true })
    await marcarHilo(c.id, "t1", { leido: false })
    expect(await contarNoLeidos([c.id])).toBe(1)
  })
})

describe("estructura", () => {
  it("borrar la casilla borra hilos y accesos en cascada", async () => {
    const c = (await upsertCasilla(A, { resendInboxId: "inbox_1", email: "ventas@cliente.example" }))!
    const u = await seedOperator(A)
    await upsertHilo(c.id, "thread_1")
    await getDb().insert(correoCasillaAccesos).values({ casillaId: c.id, adminUserId: u })
    await getDb().delete(correoCasillas).where(eq(correoCasillas.id, c.id))
    expect(await getDb().select().from(correoHilos)).toHaveLength(0)
    expect(await getDb().select().from(correoCasillaAccesos)).toHaveLength(0)
  })

  it("el par (casilla, usuario) es único", async () => {
    const c = (await upsertCasilla(A, { resendInboxId: "inbox_1", email: "ventas@cliente.example" }))!
    const u = await seedOperator(A)
    await getDb().insert(correoCasillaAccesos).values({ casillaId: c.id, adminUserId: u })
    await expect(getDb().insert(correoCasillaAccesos).values({ casillaId: c.id, adminUserId: u })).rejects.toThrow()
  })

  it("sin PII: correo_hilos solo tiene ids, carpeta, leído y fecha", async () => {
    const r = await getDb().execute(
      sql`select column_name from information_schema.columns where table_name = 'correo_hilos' order by column_name`,
    )
    const cols = (r as unknown as { column_name: string }[]).map((x) => x.column_name)
    expect(cols).toEqual(["casilla_id", "folder", "id", "leido", "resend_thread_id", "ultimo_evento_at"])
  })
})

describe("destinatariosCasilla (push)", () => {
  it("usuarios con acceso + admin/superadmin del tenant; no el operador sin acceso ni otro tenant", async () => {
    const c = (await upsertCasilla(A, { resendInboxId: "inbox_1", email: "ventas@cliente.example" }))!
    const ana = await seedOperator(A, { name: "Ana" })
    const beto = await seedOperator(A, { name: "Beto" })
    const carla = await seedOperator(A, { name: "Carla" })
    const admin = await seedOperator(A, { role: "admin" })
    const sup = await seedOperator(A, { role: "superadmin" })
    const ajeno = await seedOperator(B, { role: "admin" })
    await getDb().insert(correoCasillaAccesos).values([
      { casillaId: c.id, adminUserId: ana },
      { casillaId: c.id, adminUserId: beto },
      // un admin con fila de acceso no se duplica
      { casillaId: c.id, adminUserId: admin },
    ])
    const ids = await destinatariosCasilla(A, c.id)
    expect(ids.sort()).toEqual([ana, beto, admin, sup].sort())
    expect(ids).not.toContain(carla)
    expect(ids).not.toContain(ajeno)
  })

  it("el acceso a otra casilla no cuenta; casilla de otro tenant o inexistente = nadie", async () => {
    const c1 = (await upsertCasilla(A, { resendInboxId: "inbox_1", email: "ventas@cliente.example" }))!
    const c2 = (await upsertCasilla(A, { resendInboxId: "inbox_2", email: "soporte@cliente.example" }))!
    const ana = await seedOperator(A, { name: "Ana" })
    await getDb().insert(correoCasillaAccesos).values({ casillaId: c2.id, adminUserId: ana })
    expect(await destinatariosCasilla(A, c1.id)).toEqual([])
    expect(await destinatariosCasilla(B, c2.id)).toEqual([])
    expect(await destinatariosCasilla(A, "00000000-0000-0000-0000-000000000000")).toEqual([])
  })
})
