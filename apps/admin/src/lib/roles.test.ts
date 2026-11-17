import { describe, it, expect } from "vitest"
import * as roles from "./roles"
import { assignableRoles, canActOnRole, canManageUsers, esRolCompras, isKnownAdminRole, roleRank } from "./roles"

describe("roles", () => {
  it("ranking operator < admin < superadmin", () => {
    expect(roleRank("operator")).toBeLessThan(roleRank("admin"))
    expect(roleRank("admin")).toBeLessThan(roleRank("superadmin"))
    expect(roleRank("desconocido")).toBe(0) // fallback seguro (mínimo privilegio)
  })

  it("isKnownAdminRole: allow-list de los tres roles; lo desconocido NO pasa aunque su rank sea 0", () => {
    for (const r of ["operator", "admin", "superadmin"]) expect(isKnownAdminRole(r)).toBe(true)
    for (const r of ["viewer", "", "Operator", "admin ", "toString", "__proto__", "constructor"]) {
      expect(isKnownAdminRole(r)).toBe(false)
    }
    expect(roleRank("viewer")).toBe(0) // por esto no se puede usar `rank >= 0` como permiso
  })

  it("canManageUsers: admin y superadmin sí, operator no", () => {
    expect(canManageUsers("operator")).toBe(false)
    expect(canManageUsers("admin")).toBe(true)
    expect(canManageUsers("superadmin")).toBe(true)
  })

  it("assignableRoles: el admin crea operadores y admins, nunca superadmins", () => {
    expect(assignableRoles("superadmin")).toEqual(["operator", "admin", "superadmin", "compras"])
    expect(assignableRoles("admin")).toEqual(["operator", "admin", "compras"])
    expect(assignableRoles("admin")).not.toContain("superadmin")
    expect(assignableRoles("operator")).toEqual([])
  })

  it("canActOnRole: admin sobre operadores y admins; nunca sobre un superadmin", () => {
    // superadmin puede con cualquiera
    for (const target of ["operator", "admin", "superadmin"]) {
      expect(canActOnRole("superadmin", target)).toBe(true)
    }
    // admin gestiona el equipo (operadores y otros admins)
    expect(canActOnRole("admin", "operator")).toBe(true)
    expect(canActOnRole("admin", "admin")).toBe(true)
    // pero el superadmin es la frontera dura
    expect(canActOnRole("admin", "superadmin")).toBe(false)
    // operator no puede con nadie
    expect(canActOnRole("operator", "operator")).toBe(false)
  })

  it("compras: fuera del ranking y de la allow-list, rank 0, asignable sólo por admin+", () => {
    expect(isKnownAdminRole("compras")).toBe(false)
    expect(roleRank("compras")).toBe(0)
    expect(esRolCompras("compras")).toBe(true)
    for (const r of ["operator", "admin", "superadmin", "Compras", ""]) expect(esRolCompras(r)).toBe(false)
    expect(assignableRoles("admin")).toContain("compras")
    expect(assignableRoles("superadmin")).toContain("compras")
    expect(assignableRoles("operator")).toEqual([])
    expect(assignableRoles("compras")).toEqual([])
  })

  it("compras: sólo admin+ actúan sobre él; él no gestiona a nadie ni a usuarios", () => {
    expect(canActOnRole("admin", "compras")).toBe(true)
    expect(canActOnRole("superadmin", "compras")).toBe(true)
    expect(canActOnRole("operator", "compras")).toBe(false)
    expect(canActOnRole("compras", "operator")).toBe(false)
    expect(canActOnRole("compras", "compras")).toBe(false)
    expect(canManageUsers("compras")).toBe(false)
  })

  it("canSeeCosts se retiró: la política de costos es `puedeVerCostos` (lib/secciones.ts)", () => {
    expect("canSeeCosts" in roles).toBe(false)
  })
})
