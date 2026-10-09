import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { and, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { portalOtps } from "@/db/schema"
import { emitirOtp, hashCodigo, intentarOtp, MAX_OTP_ATTEMPTS, OTP_TTL_MS } from "@/lib/portal-otp"
import { seedTenant, truncateAll } from "./helpers"

// OTP del portal con estado en el servidor (tabla portal_otps, 0075). DB real (crm_test).
// Lo que cierra el agujero de la cookie: los intentos se cuentan en la base, no en algo que el
// cliente pueda reenviar; el código se guarda como HMAC; vale una vez y 10 minutos.

const T = "tenant-otp"
const OTRO = "tenant-otro"

beforeEach(async () => {
  await truncateAll()
  await seedTenant(T)
  await seedTenant(OTRO)
})
afterAll(truncateAll)

describe("emitirOtp", () => {
  it("guarda un HMAC del código (nunca el código) y un solo código vivo por identificador", async () => {
    const a = await emitirOtp({ tenantId: T, identifier: "20123456789", codigocliente: "42" })
    expect(a.code).toMatch(/^\d{6}$/)
    expect(a.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(OTP_TTL_MS)

    const b = await emitirOtp({ tenantId: T, identifier: "20123456789", codigocliente: "42" })
    const filas = await getDb()
      .select()
      .from(portalOtps)
      .where(and(eq(portalOtps.tenantId, T), eq(portalOtps.identifier, "20123456789")))
    expect(filas.map((f) => f.id)).toEqual([b.id])
    expect(filas[0].codeHash).toBe(hashCodigo(T, "20123456789", b.code))
    expect(filas[0].codeHash).not.toContain(b.code)
    expect(filas[0].intentos).toBe(0)
    expect(filas[0].consumedAt).toBeNull()

    // El código anterior ya no sirve.
    const viejo = await intentarOtp({ id: a.id, tenantId: T, code: a.code })
    expect(viejo).toEqual({ ok: false, motivo: "sin_otp" })
  })

  it("al emitir barre los vencidos hace más de un día del tenant", async () => {
    const hace2dias = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    const viejo = await emitirOtp({ tenantId: T, identifier: "20000000001", codigocliente: "1", now: hace2dias })
    await emitirOtp({ tenantId: T, identifier: "20000000002", codigocliente: "2" })
    const [fila] = await getDb().select().from(portalOtps).where(eq(portalOtps.id, viejo.id))
    expect(fila).toBeUndefined()
  })
})

describe("intentarOtp", () => {
  it("acierta: devuelve el contacto resuelto al emitir y el código se consume (un solo uso)", async () => {
    const otp = await emitirOtp({ tenantId: T, identifier: "20123456789", codigocliente: "42" })

    const r = await intentarOtp({ id: otp.id, tenantId: T, code: otp.code })
    expect(r).toEqual({ ok: true, identifier: "20123456789", codigocliente: "42" })

    // Reusar el mismo código (reenviando la misma cookie) no entra.
    const otraVez = await intentarOtp({ id: otp.id, tenantId: T, code: otp.code })
    expect(otraVez).toEqual({ ok: false, motivo: "sin_otp" })
  })

  it("cuenta los intentos en la base: tras 5 fallos el código queda quemado aunque después se acierte", async () => {
    const otp = await emitirOtp({ tenantId: T, identifier: "20123456789", codigocliente: "42" })
    const malo = otp.code === "000000" ? "000001" : "000000"

    for (let i = 1; i < MAX_OTP_ATTEMPTS; i++) {
      expect(await intentarOtp({ id: otp.id, tenantId: T, code: malo })).toEqual({
        ok: false,
        motivo: "incorrecto",
        restantes: MAX_OTP_ATTEMPTS - i,
      })
    }
    // Quinto fallo: agotado.
    expect(await intentarOtp({ id: otp.id, tenantId: T, code: malo })).toEqual({ ok: false, motivo: "agotado" })
    // El código correcto ya no sirve: hay que pedir otro.
    expect(await intentarOtp({ id: otp.id, tenantId: T, code: otp.code })).toEqual({ ok: false, motivo: "agotado" })

    const [fila] = await getDb().select().from(portalOtps).where(eq(portalOtps.id, otp.id))
    expect(fila.intentos).toBe(MAX_OTP_ATTEMPTS)
    expect(fila.consumedAt).toBeNull()
  })

  it("intentos en paralelo con el mismo id no comparten el contador (UPDATE atómico)", async () => {
    const otp = await emitirOtp({ tenantId: T, identifier: "20123456789", codigocliente: "42" })
    const malo = otp.code === "000000" ? "000001" : "000000"

    const resultados = await Promise.all(
      Array.from({ length: 12 }, () => intentarOtp({ id: otp.id, tenantId: T, code: malo })),
    )
    const incorrectos = resultados.filter((r) => !r.ok && r.motivo === "incorrecto")
    const agotados = resultados.filter((r) => !r.ok && r.motivo === "agotado")
    // Exactamente MAX_OTP_ATTEMPTS requests consumieron intento (4 "incorrecto" + el que agota);
    // el resto ya encontró el código quemado.
    expect(incorrectos).toHaveLength(MAX_OTP_ATTEMPTS - 1)
    expect(agotados).toHaveLength(12 - (MAX_OTP_ATTEMPTS - 1))
    const [fila] = await getDb().select().from(portalOtps).where(eq(portalOtps.id, otp.id))
    expect(fila.intentos).toBe(MAX_OTP_ATTEMPTS)
  })

  it("vencido: no acepta el código ni gasta intentos", async () => {
    const otp = await emitirOtp({ tenantId: T, identifier: "20123456789", codigocliente: "42" })
    const despues = new Date(otp.expiresAt.getTime() + 1)

    expect(await intentarOtp({ id: otp.id, tenantId: T, code: otp.code, now: despues })).toEqual({
      ok: false,
      motivo: "vencido",
    })
    const [fila] = await getDb().select().from(portalOtps).where(eq(portalOtps.id, otp.id))
    expect(fila.intentos).toBe(0)
  })

  it("un id de otro tenant o inexistente es 'sin_otp' sin gastar intentos", async () => {
    const otp = await emitirOtp({ tenantId: T, identifier: "20123456789", codigocliente: "42" })
    expect(await intentarOtp({ id: otp.id, tenantId: OTRO, code: otp.code })).toEqual({ ok: false, motivo: "sin_otp" })
    expect(await intentarOtp({ id: "no-es-uuid", tenantId: T, code: otp.code })).toEqual({ ok: false, motivo: "sin_otp" })
    expect(
      await intentarOtp({ id: "99999999-9999-4999-8999-999999999999", tenantId: T, code: otp.code }),
    ).toEqual({ ok: false, motivo: "sin_otp" })
    const [fila] = await getDb().select().from(portalOtps).where(eq(portalOtps.id, otp.id))
    expect(fila.intentos).toBe(0)
    expect(fila.consumedAt).toBeNull()
  })
})
