import { describe, it, expect, beforeEach, vi } from "vitest"
import { NextRequest } from "next/server"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { adminUsers } from "@/db/schema"
import { invalidateTenantRegistry } from "@/lib/tenants"
import { seedTenant, seedOperator, truncateAll } from "./helpers"

// Tests de AUTORIZACIÓN a nivel de RUTA. lib/roles.ts ya tiene tests unitarios de la lógica
// (quién puede asignar qué rol), pero eso no garantiza que las rutas la USEN: si alguien
// borrara el chequeo de una ruta, esos tests seguirían en verde. Acá invocamos los handlers
// reales contra la DB de test y verificamos los status que devuelven.
//
// Se mockea solo la sesión (quién está logueado) y el envío de mail; la DB y toda la lógica
// de permisos son las de verdad. El rol que cuenta es el de la FILA de admin_users (lo resuelve
// el guard), no el de la cookie.

let session: Record<string, unknown>

vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ "x-tenant-id": "tenant-a" }),
}))
vi.mock("iron-session", () => ({ getIronSession: async () => session }))
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: async () => ({ error: null }) }
  },
}))

const { POST: inviteUser } = await import("@/app/api/admin/usuarios/route")
const { PATCH: patchUser, DELETE: deleteUser } = await import("@/app/api/admin/usuarios/[id]/route")

const TENANT = "tenant-a"
const HOST = `${TENANT}.localhost`

function loginAs(userId: string, role: "operator" | "admin" | "superadmin") {
  session = { mfa: "ok", userId, role, tenantId: TENANT, name: "Test", email: "t@x.com", save: async () => {} }
}

function invite(body: unknown) {
  return inviteUser(
    new NextRequest(`http://${HOST}/api/admin/usuarios`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { host: HOST },
    }),
  )
}

function patch(targetId: string, body: unknown) {
  return patchUser(
    new NextRequest(`http://${HOST}/api/admin/usuarios/${targetId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { host: HOST },
    }),
    { params: Promise.resolve({ id: targetId }) },
  )
}

function remove(targetId: string) {
  return deleteUser(
    new NextRequest(`http://${HOST}/api/admin/usuarios/${targetId}`, { method: "DELETE", headers: { host: HOST } }),
    { params: Promise.resolve({ id: targetId }) },
  )
}

describe("permisos en las rutas de usuarios", () => {
  let operador: string
  let admin: string
  let otroAdmin: string
  let superadmin: string

  beforeEach(async () => {
    await truncateAll()
    await seedTenant(TENANT)
    invalidateTenantRegistry()
    operador = await seedOperator(TENANT, { role: "operator", name: "Opes" })
    admin = await seedOperator(TENANT, { role: "admin", name: "Admin" })
    otroAdmin = await seedOperator(TENANT, { role: "admin", name: "Otro Admin" })
    superadmin = await seedOperator(TENANT, { role: "superadmin", name: "Dueña" })
  })

  describe("rol de la cookie vs fila de admin_users", () => {
    it("una cookie con rol superadmin pero fila de operador NO da permisos (rol fresco)", async () => {
      loginAs(operador, "superadmin") // cookie vieja/forjada: la fila dice operator
      const res = await invite({ name: "X", email: "x@x.com", role: "operator" })
      expect(res.status).toBe(403)
    })

    it("un usuario borrado después de loguearse → 401", async () => {
      loginAs(admin, "admin")
      await getDb().delete(adminUsers).where(eq(adminUsers.id, admin))
      expect((await invite({ name: "X", email: "x@x.com", role: "operator" })).status).toBe(401)
    })
  })

  describe("invitar (POST)", () => {
    it("el operador no puede invitar a nadie", async () => {
      loginAs(operador, "operator")
      const res = await invite({ name: "X", email: "x@x.com", role: "operator" })
      expect(res.status).toBe(403)
    })

    it("el admin puede invitar operadores", async () => {
      loginAs(admin, "admin")
      const res = await invite({ name: "Nuevo", email: "nuevo@x.com", role: "operator" })
      expect(res.status).toBe(201)
    })

    it("el admin puede invitar otros admins", async () => {
      loginAs(admin, "admin")
      const res = await invite({ name: "Nuevo Admin", email: "na@x.com", role: "admin" })
      expect(res.status).toBe(201)
    })

    it("el admin NO puede crear un superadmin (frontera dura)", async () => {
      loginAs(admin, "admin")
      const res = await invite({ name: "Colado", email: "colado@x.com", role: "superadmin" })
      expect(res.status).toBe(403)
      // y no quedó creado
      const rows = await getDb().select().from(adminUsers).where(eq(adminUsers.email, "colado@x.com"))
      expect(rows).toHaveLength(0)
    })

    it("el superadmin sí puede crear superadmins", async () => {
      loginAs(superadmin, "superadmin")
      const res = await invite({ name: "Socia", email: "socia@x.com", role: "superadmin" })
      expect(res.status).toBe(201)
    })
  })

  describe("editar (PATCH)", () => {
    it("el admin puede editar a un operador", async () => {
      loginAs(admin, "admin")
      expect((await patch(operador, { name: "Renombrado" })).status).toBe(200)
    })

    it("el admin puede editar a otro admin", async () => {
      loginAs(admin, "admin")
      expect((await patch(otroAdmin, { name: "Renombrado" })).status).toBe(200)
    })

    it("el admin NO puede editar a un superadmin", async () => {
      loginAs(admin, "admin")
      const res = await patch(superadmin, { name: "Hackeado" })
      expect(res.status).toBe(403)
      const [row] = await getDb().select().from(adminUsers).where(eq(adminUsers.id, superadmin))
      expect(row.name).toBe("Dueña") // no se modificó
    })

    it("el admin NO puede promover a nadie a superadmin", async () => {
      loginAs(admin, "admin")
      const res = await patch(operador, { role: "superadmin" })
      expect(res.status).toBe(403)
      const [row] = await getDb().select().from(adminUsers).where(eq(adminUsers.id, operador))
      expect(row.role).toBe("operator") // siguió siendo operador
    })

    it("el operador no puede editar a otro usuario", async () => {
      loginAs(operador, "operator")
      expect((await patch(admin, { name: "X" })).status).toBe(403)
    })

    it("cualquiera puede editar su propio nombre", async () => {
      loginAs(operador, "operator")
      expect((await patch(operador, { name: "Mi Nombre" })).status).toBe(200)
    })
  })

  describe("eliminar (DELETE)", () => {
    it("el admin puede eliminar a un operador", async () => {
      loginAs(admin, "admin")
      expect((await remove(operador)).status).toBe(200)
    })

    it("el admin NO puede eliminar a un superadmin", async () => {
      loginAs(admin, "admin")
      expect((await remove(superadmin)).status).toBe(403)
      const rows = await getDb().select().from(adminUsers).where(eq(adminUsers.id, superadmin))
      expect(rows).toHaveLength(1) // sigue existiendo
    })

    it("el operador no puede eliminar a nadie", async () => {
      loginAs(operador, "operator")
      expect((await remove(admin)).status).toBe(403)
    })

    it("nadie puede eliminarse a sí mismo", async () => {
      loginAs(superadmin, "superadmin")
      expect((await remove(superadmin)).status).toBe(400)
    })
  })

  describe("secciones y costos (S3)", () => {
    async function fila(id: string) {
      const [row] = await getDb().select().from(adminUsers).where(eq(adminUsers.id, id))
      return row
    }
    async function setPermisos(id: string, secciones: string[] | null, verCostos: boolean | null) {
      await getDb().update(adminUsers).set({ seccionesPermitidas: secciones, verCostos }).where(eq(adminUsers.id, id))
    }

    it("el admin otorga secciones y costos a un operador; la respuesta trae los valores", async () => {
      loginAs(admin, "admin")
      const res = await patch(operador, { secciones_permitidas: ["pedidos", "inbox", "pedidos"], ver_costos: true })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.secciones_permitidas).toEqual(["inbox", "pedidos"])
      expect(body.ver_costos).toBe(true)
      expect((await fila(operador)).seccionesPermitidas).toEqual(["inbox", "pedidos"])
    })

    it("Restablecer al rol: null vuelve las dos columnas a NULL", async () => {
      await setPermisos(operador, ["pedidos"], false)
      loginAs(admin, "admin")
      expect((await patch(operador, { secciones_permitidas: null, ver_costos: null })).status).toBe(200)
      const row = await fila(operador)
      expect(row.seccionesPermitidas).toBeNull()
      expect(row.verCostos).toBeNull()
    })

    it("clave no tildable -> 400 «Sección no válida.»", async () => {
      loginAs(admin, "admin")
      const res = await patch(operador, { secciones_permitidas: ["usuarios"] })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe("Sección no válida.")
    })

    it("nadie modifica sus propios permisos -> 403", async () => {
      loginAs(admin, "admin")
      const res = await patch(admin, { secciones_permitidas: [] })
      expect(res.status).toBe(403)
      expect((await res.json()).error).toBe("No puede modificar sus propios permisos.")
    })

    it("techo: un admin con ['pedidos','catalogo'] no da ['inbox','etiquetas'] y no se persiste nada", async () => {
      await setPermisos(admin, ["pedidos", "catalogo"], null)
      await setPermisos(operador, [], null)
      loginAs(admin, "admin")
      const res = await patch(operador, { secciones_permitidas: ["inbox", "etiquetas"] })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe("No puede otorgar secciones a las que usted no tiene acceso.")
      expect((await fila(operador)).seccionesPermitidas).toEqual([])
    })

    it("techo de costos: un admin sin costos no los otorga", async () => {
      await setPermisos(admin, null, false)
      loginAs(admin, "admin")
      expect((await patch(operador, { ver_costos: true })).status).toBe(400)
    })

    it("el admin no edita permisos de un superadmin (canActOnRole)", async () => {
      loginAs(admin, "admin")
      expect((await patch(superadmin, { secciones_permitidas: ["inbox"] })).status).toBe(403)
    })

    it("superadmin con valores no nulos -> 400", async () => {
      loginAs(superadmin, "superadmin")
      const res = await patch(admin, { role: "superadmin", secciones_permitidas: ["inbox"] })
      expect(res.status).toBe(400)
      expect((await fila(admin)).role).toBe("admin")
    })

    it("operador ['inbox','pedidos'] -> admin conserva la lista; admin -> superadmin la limpia", async () => {
      await setPermisos(operador, ["inbox", "pedidos"], false)
      loginAs(superadmin, "superadmin")
      const res = await patch(operador, { role: "admin" })
      expect(res.status).toBe(200)
      expect((await res.json()).secciones_permitidas).toEqual(["inbox", "pedidos"])
      const res2 = await patch(operador, { role: "superadmin" })
      const body2 = await res2.json()
      expect(body2.secciones_permitidas).toBeNull()
      expect(body2.ver_costos).toBeNull()
    })

    it("debe quedar al menos un gestor: el actor cuenta, así que bajar al otro admin pasa", async () => {
      // La regla (quedaGestor, unit) es una defensa: como nadie se edita ni se elimina a sí mismo,
      // el actor (admin+ activo del tenant) siempre queda como gestor.
      await getDb().delete(adminUsers).where(eq(adminUsers.id, otroAdmin))
      loginAs(superadmin, "superadmin")
      expect((await patch(admin, { role: "operator" })).status).toBe(200)
      expect((await remove(admin)).status).toBe(200)
    })

    it("con otro gestor activo sí se puede bajar de rol", async () => {
      loginAs(superadmin, "superadmin")
      expect((await patch(otroAdmin, { role: "operator" })).status).toBe(200)
    })

    it("alta de un admin con techo: queda con lo que el actor puede dar", async () => {
      await setPermisos(admin, ["pedidos"], false)
      loginAs(admin, "admin")
      const res = await invite({ name: "Nuevo", email: "nuevo-techo@x.com", role: "admin" })
      expect(res.status).toBe(201)
      const [row] = await getDb().select().from(adminUsers).where(eq(adminUsers.email, "nuevo-techo@x.com"))
      expect(row.seccionesPermitidas).toEqual(["pedidos"])
      expect(row.verCostos).toBe(false)
    })
  })
})
