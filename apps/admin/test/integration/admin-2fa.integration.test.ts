import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { adminUsers } from "@/db/schema"
import { invalidateTenantRegistry } from "@/lib/tenants"
import { hashPassword } from "@/lib/admin-crypto"
import { codigoDelPaso, descifrarSecreto, pasoActual } from "@/lib/admin-totp"
import { seedOperator, seedTenant, truncateAll } from "./helpers"

// Verificación en dos pasos (0096) punta a punta contra la base real de test: login → alta con
// QR → códigos de respaldo → login con código, más los casos que importan para seguridad
// (código reusado, respaldo de un solo uso, restablecer, guard). Cookie y host mockeados.

let session: Record<string, unknown>

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({
  getIronSession: async () => {
    session.save ??= async () => {}
    session.destroy ??= () => {
      for (const k of Object.keys(session)) if (k !== "save" && k !== "destroy") delete session[k]
    }
    return session
  },
}))
// Sin Redis en tests: el cupo de intentos cae al contador en memoria.
vi.mock("@/lib/rate-limit", async (orig) => {
  const real = await orig<typeof import("@/lib/rate-limit")>()
  return { ...real, permitirAsync: async () => true }
})

const { POST: login } = await import("@/app/api/admin/auth/login/route")
const { POST: verificar } = await import("@/app/api/admin/auth/2fa/verificar/route")
const { POST: confirmarAltaRuta } = await import("@/app/api/admin/auth/2fa/alta/route")
const { DELETE: restablecer } = await import("@/app/api/admin/usuarios/[id]/2fa/route")
const { getGuardedAdminSession } = await import("@/lib/admin-session")

const HOST = "tenant-a.plataforma.example"
const post = (path: string, body: unknown) =>
  new Request(`http://${HOST}${path}`, {
    method: "POST",
    headers: { host: HOST, "content-type": "application/json" },
    body: JSON.stringify(body),
  })

let userId: string

async function codigoActual(): Promise<string> {
  const [u] = await getDb().select({ s: adminUsers.totpSecretEnc }).from(adminUsers).where(eq(adminUsers.id, userId))
  return codigoDelPaso(descifrarSecreto(u.s!), pasoActual(Date.now()))
}

/** Login + alta completos. Devuelve los códigos de respaldo. */
async function darDeAlta(): Promise<string[]> {
  const r = await login(post("/api/admin/auth/login", { email: "ana@cliente.example", password: "secreta" }) as never)
  expect(await r.json()).toEqual({ ok: true, paso: "alta" })
  const secreto = descifrarSecreto((session.mfaPendiente as { secretoEnc: string }).secretoEnc)
  const a = await confirmarAltaRuta(post("/api/admin/auth/2fa/alta", { codigo: codigoDelPaso(secreto, pasoActual(Date.now())) }))
  expect(a.status).toBe(200)
  return (await a.json()).codigosRespaldo
}

beforeEach(async () => {
  await truncateAll()
  invalidateTenantRegistry()
  await seedTenant("tenant-a")
  userId = await seedOperator("tenant-a", { role: "operator" })
  await getDb()
    .update(adminUsers)
    .set({ email: "ana@cliente.example", passwordHash: await hashPassword("secreta") })
    .where(eq(adminUsers.id, userId))
  session = {}
})
afterAll(truncateAll)

describe("2FA del backoffice", () => {
  it("un operador sin 2FA no entra con sólo la contraseña: tiene que darlo de alta", async () => {
    const codigos = await darDeAlta()
    expect(codigos).toHaveLength(10)
    expect(session.userId).toBe(userId)
    expect(session.mfa).toBe("ok")
    const g = await getGuardedAdminSession(new Request(`http://${HOST}/x`, { headers: { host: HOST } }))
    expect(g.ok).toBe(true)
  })

  it("la sesión pendiente no pasa el guard", async () => {
    await login(post("/api/admin/auth/login", { email: "ana@cliente.example", password: "secreta" }) as never)
    const g = await getGuardedAdminSession(new Request(`http://${HOST}/x`, { headers: { host: HOST } }))
    expect(g).toEqual({ ok: false, reason: "no-session" })
  })

  it("un código mal no abre sesión; uno bueno sí, y no vale dos veces", async () => {
    await darDeAlta()
    session = {}
    await login(post("/api/admin/auth/login", { email: "ana@cliente.example", password: "secreta" }) as never)
    expect((session.mfaPendiente as { modo: string }).modo).toBe("verificar")

    const mal = await verificar(post("/api/admin/auth/2fa/verificar", { codigo: "000000" }))
    expect(mal.status).toBe(401)
    expect(session.userId).toBeUndefined()

    // El código del alta ya quemó el paso actual: el mismo código no vuelve a servir.
    const reusado = await verificar(post("/api/admin/auth/2fa/verificar", { codigo: await codigoActual() }))
    expect(reusado.status).toBe(401)

    // Un paso posterior (el reloj del celular adelantado 30 s) sí.
    const [u] = await getDb().select({ s: adminUsers.totpSecretEnc }).from(adminUsers).where(eq(adminUsers.id, userId))
    const siguiente = codigoDelPaso(descifrarSecreto(u.s!), pasoActual(Date.now()) + 1)
    const ok = await verificar(post("/api/admin/auth/2fa/verificar", { codigo: siguiente }))
    expect(ok.status).toBe(200)
    expect(session.userId).toBe(userId)
  })

  it("un código de respaldo sirve una sola vez", async () => {
    const codigos = await darDeAlta()
    for (const esperado of [200, 401]) {
      session = {}
      await login(post("/api/admin/auth/login", { email: "ana@cliente.example", password: "secreta" }) as never)
      const r = await verificar(post("/api/admin/auth/2fa/verificar", { codigo: codigos[0].toLowerCase() }))
      expect(r.status).toBe(esperado)
      if (esperado === 200) expect((await r.json()).quedanRespaldo).toBe(9)
    }
  })

  it("una cookie de antes del 2FA (sin marca) no pasa el guard", async () => {
    session = { userId, tenantId: "tenant-a", role: "operator", name: "x", email: "x@cliente.example", issuedAt: Date.now() }
    const g = await getGuardedAdminSession(new Request(`http://${HOST}/x`, { headers: { host: HOST } }))
    expect(g).toEqual({ ok: false, reason: "mfa" })
  })

  it("un admin restablece el 2FA de otro: se borra y se cierran sus sesiones", async () => {
    await darDeAlta()
    const adminId = await seedOperator("tenant-a", { role: "admin" })
    session = { userId: adminId, tenantId: "tenant-a", role: "admin", name: "y", email: "y@cliente.example", mfa: "ok", issuedAt: Date.now() }

    const r = await restablecer(
      new Request(`http://${HOST}/api/admin/usuarios/${userId}/2fa`, { method: "DELETE", headers: { host: HOST } }),
      { params: Promise.resolve({ id: userId }) },
    )
    expect(r.status).toBe(200)
    const [u] = await getDb().select().from(adminUsers).where(eq(adminUsers.id, userId))
    expect(u.totpSecretEnc).toBeNull()
    expect(u.totpRecoveryHashes).toEqual([])
    expect(u.sessionsRevokedBefore).not.toBeNull()
  })

  it("nadie restablece su propio 2FA", async () => {
    const adminId = await seedOperator("tenant-a", { role: "admin" })
    session = { userId: adminId, tenantId: "tenant-a", role: "admin", name: "y", email: "y@cliente.example", mfa: "ok", issuedAt: Date.now() }
    const r = await restablecer(
      new Request(`http://${HOST}/api/admin/usuarios/${adminId}/2fa`, { method: "DELETE", headers: { host: HOST } }),
      { params: Promise.resolve({ id: adminId }) },
    )
    expect(r.status).toBe(400)
  })
})
