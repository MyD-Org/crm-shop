import { describe, it, expect } from "vitest"
import {
  ERROR_COMPRAS_SOLO,
  ERROR_SECCION_NO_VALIDA,
  ERROR_SUPERADMIN_TODO,
  ERROR_TECHO_COSTOS,
  ERROR_TECHO_SECCIONES,
  parseSeccionesPermitidas,
  parseVerCostos,
  permisosDeAlta,
  quedaGestor,
  resolverPermisos,
  validarTecho,
} from "./permisos-usuario"
import { SECCIONES_TILDABLES } from "./secciones"

const superadmin = { role: "superadmin" }
const adminTodo = { role: "admin", seccionesPermitidas: null, verCostos: null }
const adminAcotado = { role: "admin", seccionesPermitidas: ["pedidos", "catalogo"], verCostos: false }
const operadorNull = { role: "operator", seccionesPermitidas: null, verCostos: null }

describe("parseSeccionesPermitidas", () => {
  it("null restablece al rol", () => {
    expect(parseSeccionesPermitidas(null)).toEqual({ ok: true, value: null })
  })
  it("normaliza duplicados y ordena según el catálogo", () => {
    expect(parseSeccionesPermitidas(["catalogo", "inbox", "catalogo"])).toEqual({ ok: true, value: ["inbox", "catalogo"] })
  })
  it("lista vacía es válida", () => {
    expect(parseSeccionesPermitidas([])).toEqual({ ok: true, value: [] })
  })
  it.each([[["usuarios"]], [["plantillas"]], [["seguridad"]], [["uso"]], [["xyz"]], [[1]], ["inbox"], [{}]])(
    "rechaza %j con «Sección no válida.»",
    (v) => {
      expect(parseSeccionesPermitidas(v)).toEqual({ ok: false, error: ERROR_SECCION_NO_VALIDA })
    },
  )
})

describe("parseVerCostos", () => {
  it("acepta null y boolean, rechaza el resto", () => {
    expect(parseVerCostos(null)).toEqual({ ok: true, value: null })
    expect(parseVerCostos(true)).toEqual({ ok: true, value: true })
    expect(parseVerCostos("true").ok).toBe(false)
  })
})

describe("validarTecho", () => {
  it("el superadmin no tiene techo", () => {
    expect(validarTecho(superadmin, operadorNull, { role: "admin", seccionesPermitidas: null, verCostos: true })).toBeNull()
  })
  it("admin con ['pedidos','catalogo'] no puede dar ['inbox','etiquetas'] (spec)", () => {
    expect(
      validarTecho(adminAcotado, operadorNull, { role: "operator", seccionesPermitidas: ["inbox", "etiquetas"], verCostos: null }),
    ).toBe(ERROR_TECHO_SECCIONES)
  })
  it("conservar lo que el objetivo ya tenía (aunque el actor no lo tenga) está permitido", () => {
    // El operador ya veía inbox por default; el actor sin inbox le suma pedidos.
    expect(
      validarTecho(adminAcotado, operadorNull, { role: "operator", seccionesPermitidas: ["inbox", "pedidos"], verCostos: null }),
    ).toBeNull()
  })
  it("quitar siempre está permitido", () => {
    expect(validarTecho(adminAcotado, operadorNull, { role: "operator", seccionesPermitidas: [], verCostos: null })).toBeNull()
  })
  it("no puede dar costos si no los ve", () => {
    expect(validarTecho(adminAcotado, operadorNull, { role: "operator", seccionesPermitidas: null, verCostos: true })).toBe(
      ERROR_TECHO_COSTOS,
    )
  })
  it("Restablecer al rol que suma secciones fuera del techo se rechaza", () => {
    const objetivo = { role: "admin", seccionesPermitidas: ["pedidos"], verCostos: false }
    expect(validarTecho(adminAcotado, objetivo, { role: "admin", seccionesPermitidas: null, verCostos: false })).toBe(
      ERROR_TECHO_SECCIONES,
    )
  })
})

describe("resolverPermisos", () => {
  it("operador ['inbox','pedidos'] -> admin conserva exactamente la lista", () => {
    const r = resolverPermisos(superadmin, { role: "operator", seccionesPermitidas: ["inbox", "pedidos"], verCostos: null }, { rolNuevo: "admin" })
    expect(r).toEqual({ ok: true, value: { seccionesPermitidas: ["inbox", "pedidos"], verCostos: null } })
  })
  it("admin ['pedidos'] + costos false -> superadmin: ambos NULL", () => {
    const r = resolverPermisos(superadmin, { role: "admin", seccionesPermitidas: ["pedidos"], verCostos: false }, { rolNuevo: "superadmin" })
    expect(r).toEqual({ ok: true, value: { seccionesPermitidas: null, verCostos: null } })
  })
  it("superadmin con lista residual -> admin: NULL", () => {
    const r = resolverPermisos(superadmin, { role: "superadmin", seccionesPermitidas: ["inbox"], verCostos: false }, { rolNuevo: "admin" })
    expect(r).toEqual({ ok: true, value: { seccionesPermitidas: null, verCostos: null } })
  })
  it("rol final superadmin o compras con valores no nulos: 400", () => {
    expect(resolverPermisos(superadmin, operadorNull, { rolNuevo: "superadmin", secciones: ["inbox"] })).toEqual({
      ok: false,
      error: ERROR_SUPERADMIN_TODO,
    })
    expect(resolverPermisos(adminTodo, operadorNull, { rolNuevo: "compras", verCostos: false })).toEqual({
      ok: false,
      error: ERROR_COMPRAS_SOLO,
    })
  })
  it("un residuo en un superadmin no bloquea otros cambios: se limpia", () => {
    const r = resolverPermisos(superadmin, { role: "superadmin", seccionesPermitidas: ["inbox"], verCostos: false }, { rolNuevo: "superadmin" })
    expect(r).toEqual({ ok: true, value: { seccionesPermitidas: null, verCostos: null } })
  })
  it("el cuerpo manda sobre la política del cambio de rol", () => {
    const r = resolverPermisos(superadmin, { role: "operator", seccionesPermitidas: ["inbox"], verCostos: null }, { rolNuevo: "admin", secciones: null })
    expect(r).toEqual({ ok: true, value: { seccionesPermitidas: null, verCostos: null } })
  })
  it("el techo se revalida sobre el resultado del cambio de rol", () => {
    // operador NULL -> admin NULL: pasa a ver todas las tildables; el admin acotado no puede darlas.
    expect(resolverPermisos(adminAcotado, operadorNull, { rolNuevo: "admin" })).toEqual({ ok: false, error: ERROR_TECHO_SECCIONES })
  })
  it("clave inválida en el cuerpo", () => {
    expect(resolverPermisos(adminTodo, operadorNull, { rolNuevo: "operator", secciones: ["usuarios"] })).toEqual({
      ok: false,
      error: ERROR_SECCION_NO_VALIDA,
    })
  })
})

describe("permisosDeAlta", () => {
  it("sin techo: NULL (default del rol)", () => {
    expect(permisosDeAlta(adminTodo, "admin")).toEqual({ ok: true, value: { seccionesPermitidas: null, verCostos: null } })
    expect(permisosDeAlta(superadmin, "operator")).toEqual({ ok: true, value: { seccionesPermitidas: null, verCostos: null } })
  })
  it("con techo: lo que el actor puede dar y sin costos", () => {
    expect(permisosDeAlta(adminAcotado, "admin")).toEqual({
      ok: true,
      value: { seccionesPermitidas: ["pedidos", "catalogo"], verCostos: false },
    })
    // El operador por defecto ve inbox; el actor no lo tiene.
    expect(permisosDeAlta(adminAcotado, "operator")).toEqual({ ok: true, value: { seccionesPermitidas: [], verCostos: null } })
  })
  it("rol «compras» sin la sección en el techo: error", () => {
    expect(permisosDeAlta(adminAcotado, "compras")).toEqual({ ok: false, error: ERROR_TECHO_SECCIONES })
  })
  it("todas las tildables existen", () => {
    expect(SECCIONES_TILDABLES.length).toBe(13)
  })
})

describe("quedaGestor", () => {
  const u = (id: string, role: string, activo = true) => ({ id, role, activo })
  it("único admin activo: no se puede quitar", () => {
    expect(quedaGestor([u("a", "admin"), u("o", "operator")], "a")).toBe(false)
  })
  it("un admin con invitación pendiente no cuenta", () => {
    expect(quedaGestor([u("a", "admin"), u("b", "admin", false)], "a")).toBe(false)
  })
  it("con otro superadmin activo sí", () => {
    expect(quedaGestor([u("a", "admin"), u("s", "superadmin")], "a")).toBe(true)
  })
  it("un objetivo que no gestiona no cambia nada", () => {
    expect(quedaGestor([u("o", "operator")], "o")).toBe(true)
  })
})
