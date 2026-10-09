import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { adminUsers } from "@/db/schema"
import { invalidateTenantRegistry } from "@/lib/tenants"
import { seedOperator, seedTenant, truncateAll } from "./helpers"

// Revocación de sesiones del admin (0075): `admin_users.sessions_revoked_before` invalida las
// cookies emitidas antes (reset de contraseña). DB real (crm_test); cookie y host mockeados.

let session: Record<string, unknown>

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))

const { getGuardedAdminSession } = await import("@/lib/admin-session")
const { POST: resetPassword } = await import("@/app/api/admin/auth/reset-password/route")

const req = () => new Request("http://tenant-a.plataforma.example/api/x", { headers: { host: "tenant-a.plataforma.example" } })

let userId: string

beforeEach(async () => {
  await truncateAll()
  invalidateTenantRegistry()
  await seedTenant("tenant-a")
  userId = await seedOperator("tenant-a", { role: "admin" })
  session = { userId, tenantId: "tenant-a", role: "admin", name: "x", email: "x@example.com" }
})
afterAll(truncateAll)

describe("getGuardedAdminSession + sessions_revoked_before", () => {
  it("sin revocación, una cookie de antes de 0075 (sin issuedAt) sigue valiendo", async () => {
    const g = await getGuardedAdminSession(req())
    expect(g.ok).toBe(true)
  })

  it("una cookie emitida antes de la revocación cae con 'revoked'; una posterior entra", async () => {
    const corte = new Date()
    await getDb().update(adminUsers).set({ sessionsRevokedBefore: corte }).where(eq(adminUsers.id, userId))

    session.issuedAt = corte.getTime() - 1000
    expect(await getGuardedAdminSession(req())).toEqual({ ok: false, reason: "revoked" })

    delete session.issuedAt // cookie vieja sin marca: también cae
    expect(await getGuardedAdminSession(req())).toEqual({ ok: false, reason: "revoked" })

    session.issuedAt = corte.getTime() + 1000
    expect((await getGuardedAdminSession(req())).ok).toBe(true)
  })

  it("reset-password marca la revocación: la cookie anterior deja de servir", async () => {
    const { generateToken } = await import("@/lib/admin-crypto")
    const { adminPasswordTokens } = await import("@/db/schema")
    const { token, tokenHash } = generateToken()
    await getDb().insert(adminPasswordTokens).values({
      userId,
      tokenHash,
      type: "reset",
      expiresAt: new Date(Date.now() + 60_000),
    })
    session.issuedAt = Date.now() - 60_000
    expect((await getGuardedAdminSession(req())).ok).toBe(true)

    const res = await resetPassword(
      new (await import("next/server")).NextRequest("http://tenant-a.plataforma.example/api/admin/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.50" },
        body: JSON.stringify({ token, password: "nueva-clave-segura" }),
      }),
    )
    expect(res.status).toBe(200)

    expect(await getGuardedAdminSession(req())).toEqual({ ok: false, reason: "revoked" })
  })
})
