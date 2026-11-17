import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { adminUsers } from "@/db/schema"
import { invalidateTenantRegistry } from "@/lib/tenants"
import { seedOperator, seedTenant, truncateAll } from "./helpers"

// Permisos por sección (0106): `getGuardedAdminSession` devuelve `secciones_permitidas` y
// `ver_costos` de la fila FRESCA (NULL y con valores) y sigue respetando el tenant.
// DB real (crm_test); cookie y host mockeados.

let session: Record<string, unknown>
let tenantHeader = "tenant-a"

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": tenantHeader }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))

const { getGuardedAdminSession } = await import("@/lib/admin-session")
const { configurarFlagCompras, requireSeccion } = await import("@/lib/admin-route-guard")
const { accesoSeccion } = await import("@/lib/secciones-acceso")

let userId: string

beforeEach(async () => {
  await truncateAll()
  invalidateTenantRegistry()
  tenantHeader = "tenant-a"
  await seedTenant("tenant-a")
  await seedTenant("tenant-b")
  userId = await seedOperator("tenant-a", { role: "operator" })
  session = { userId, tenantId: "tenant-a", role: "operator", name: "x", email: "x@example.com", mfa: "ok" }
})
afterAll(truncateAll)

describe("getGuardedAdminSession + secciones/costos (0106)", () => {
  it("con las columnas NULL devuelve null en ambas", async () => {
    const g = await getGuardedAdminSession()
    expect(g.ok).toBe(true)
    if (!g.ok) return
    expect(g.user.seccionesPermitidas).toBeNull()
    expect(g.user.verCostos).toBeNull()
  })

  it("devuelve los valores de la fila, y un cambio rige en el siguiente request", async () => {
    await getDb()
      .update(adminUsers)
      .set({ seccionesPermitidas: ["inbox", "pedidos"], verCostos: true })
      .where(eq(adminUsers.id, userId))
    let g = await getGuardedAdminSession()
    expect(g.ok && g.user.seccionesPermitidas).toEqual(["inbox", "pedidos"])
    expect(g.ok && g.user.verCostos).toBe(true)

    await getDb().update(adminUsers).set({ seccionesPermitidas: [], verCostos: false }).where(eq(adminUsers.id, userId))
    g = await getGuardedAdminSession()
    expect(g.ok && g.user.seccionesPermitidas).toEqual([])
    expect(g.ok && g.user.verCostos).toBe(false)
  })

  it("respeta el tenant: desde otro tenant no hay sesión", async () => {
    await getDb().update(adminUsers).set({ seccionesPermitidas: ["pedidos"] }).where(eq(adminUsers.id, userId))
    tenantHeader = "tenant-b"
    expect(await getGuardedAdminSession()).toEqual({ ok: false, reason: "tenant-mismatch" })
  })
})

describe("requireSeccion / accesoSeccion contra la fila fresca (S2a)", () => {
  const req = () => new Request("http://tenant-a.localhost/api/admin/pedidos", { headers: { host: "tenant-a.localhost" } })
  const NOT_FOUND = { error: "No encontrado", code: "not_found" }

  it("efecto inmediato: quitar `pedidos` deniega el siguiente request sin volver a iniciar sesión", async () => {
    await getDb().update(adminUsers).set({ seccionesPermitidas: ["inbox", "pedidos"] }).where(eq(adminUsers.id, userId))
    expect((await requireSeccion(req(), "pedidos")).ok).toBe(true)
    expect(await accesoSeccion("pedidos")).not.toBeNull()

    await getDb().update(adminUsers).set({ seccionesPermitidas: ["inbox"] }).where(eq(adminUsers.id, userId))
    const r = await requireSeccion(req(), "pedidos")
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.response.status).toBe(404)
      expect(await r.response.json()).toEqual(NOT_FOUND)
    }
    expect(await accesoSeccion("pedidos")).toBeNull()
  })

  it("columnas NULL: mismo acceso que el rango de rol de antes, para los cuatro roles", async () => {
    configurarFlagCompras(async () => true)
    const casos: [string, Record<string, boolean>][] = [
      ["operator", { inbox: true, pedidos: false, catalogo: false, compras: false, usuarios: false, plantillas: false }],
      ["admin", { inbox: true, pedidos: true, catalogo: true, compras: true, usuarios: true, plantillas: false }],
      ["superadmin", { inbox: true, pedidos: true, catalogo: true, compras: true, usuarios: true, plantillas: true }],
      ["compras", { inbox: false, pedidos: false, catalogo: false, compras: true, usuarios: false, plantillas: false }],
    ]
    for (const [role, esperado] of casos) {
      await getDb().update(adminUsers).set({ role, seccionesPermitidas: null, verCostos: null }).where(eq(adminUsers.id, userId))
      for (const [clave, ok] of Object.entries(esperado)) {
        const r = await requireSeccion(req(), clave as Parameters<typeof requireSeccion>[1])
        expect(r.ok, `${role} -> ${clave}`).toBe(ok)
      }
    }
  })

  it("sin sesión: 401", async () => {
    session = {}
    const r = await requireSeccion(req(), "inbox")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(401)
    expect(await accesoSeccion("inbox")).toBeNull()
  })
})
