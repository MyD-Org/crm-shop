import { beforeEach, describe, expect, it, vi } from "vitest"

// El correo vive dentro de Mensajes (permisos-por-seccion): requireCorreoAdmin y requireCorreoLector
// exigen además la sección `inbox`. Con las columnas NULL, igual que antes.
const estado = vi.hoisted(() => ({ user: {} as Record<string, unknown> }))

vi.mock("@/lib/admin-session", () => ({
  getGuardedAdminSession: async () => ({ ok: true, tenantId: "t1", user: estado.user }),
}))
vi.mock("@/lib/correo-flag", () => ({ correoHabilitado: async () => true }))
vi.mock("@/lib/correo-acceso", () => ({
  requireCasilla: async () => ({ ok: true, casilla: { id: "c1" } }),
}))
vi.mock("@/lib/correo-repo", () => ({}))
vi.mock("@/lib/correo-resend", () => ({ CorreoResendError: class extends Error {} }))

import { requireCorreoAdmin } from "./correo-admin"
import { requireCorreoLector } from "./correo-lectura"

const req = new Request("http://localhost/api/admin/correo/casillas")
const como = (role: string, seccionesPermitidas: string[] | null = null) => {
  estado.user = { id: "u1", name: "N", email: "n@cliente.example", role, canalesPermitidos: null, seccionesPermitidas }
}
const status = (r: { ok: boolean; response?: Response }) => (r.ok ? 200 : r.response!.status)

beforeEach(() => como("operator"))

describe("guards del correo + sección Mensajes", () => {
  it("lector: operador con NULL lee; sin `inbox` en su lista, 404", async () => {
    expect(status(await requireCorreoLector(req, "c1"))).toBe(200)
    como("operator", ["pedidos"])
    expect(status(await requireCorreoLector(req, "c1"))).toBe(404)
  })

  it("administración: admin con NULL pasa; admin sin `inbox` 404; operador 404 como siempre", async () => {
    como("admin")
    expect(status(await requireCorreoAdmin(req))).toBe(200)
    como("admin", ["pedidos"])
    expect(status(await requireCorreoAdmin(req))).toBe(404)
    como("operator", ["inbox"])
    expect(status(await requireCorreoAdmin(req))).toBe(404)
  })
})
