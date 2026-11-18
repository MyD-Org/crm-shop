import { describe, it, expect } from "vitest"
import {
  AVISO_LISTA_CONSERVADA,
  AVISO_SIN_SECCIONES,
  MOTIVO_FUERA_DE_TECHO,
  alternarSeccion,
  avisoPermisos,
  badgePermisos,
  costosMarcado,
  errorTechoPermisos,
  estadoCasilla,
  estadoCasillaCostos,
  permisosFormDesde,
  permisosPayload,
  permisosSinGuardar,
  permisosTrasCambioDeRol,
  restablecerPermisos,
  seccionesMarcadas,
  seccionesPorGrupo,
  segunElRol,
} from "./permisos-form"

const porRol = restablecerPermisos()

describe("permisos-form", () => {
  it("según el rol: marca el default del rol", () => {
    expect(segunElRol(porRol)).toBe(true)
    expect(seccionesMarcadas(porRol, "operator")).toEqual(["inbox"])
    expect(seccionesMarcadas(porRol, "admin")).toContain("etiquetas")
    expect(costosMarcado(porRol, "operator")).toBe(false)
    expect(costosMarcado(porRol, "admin")).toBe(true)
  })

  it("tocar una casilla en modo rol pasa a lista explícita desde el default", () => {
    const f = alternarSeccion(porRol, "operator", "pedidos")
    expect(f.secciones).toEqual(["inbox", "pedidos"])
    expect(segunElRol(f)).toBe(false)
  })

  it("Restablecer al rol envía null en las dos columnas (spec)", () => {
    const original = permisosFormDesde(["pedidos"], false)
    expect(permisosPayload(original, restablecerPermisos())).toEqual({ secciones_permitidas: null, ver_costos: null })
  })

  it("payload sólo con lo que cambió; sin cambios, vacío", () => {
    const original = permisosFormDesde(["inbox", "pedidos"], null)
    expect(permisosPayload(original, permisosFormDesde(["pedidos", "inbox"], null))).toEqual({})
    expect(permisosPayload(original, { ...original, verCostos: true })).toEqual({ ver_costos: true })
  })

  it("cambios sin guardar por conjunto", () => {
    const original = permisosFormDesde(["inbox", "pedidos"], null)
    expect(permisosSinGuardar(original, permisosFormDesde(["pedidos", "inbox"], null))).toBe(false)
    expect(permisosSinGuardar(original, permisosFormDesde(["pedidos"], null))).toBe(true)
    expect(permisosSinGuardar(original, porRol)).toBe(true)
  })

  it("lista vacía avisa", () => {
    expect(avisoPermisos(permisosFormDesde([], null))).toBe(AVISO_SIN_SECCIONES)
    expect(avisoPermisos(porRol)).toBeNull()
  })

  it("badge de la tabla", () => {
    expect(badgePermisos("operator", null)).toBe("Según el rol")
    expect(badgePermisos("admin", [])).toBe("Sin secciones")
    expect(badgePermisos("admin", ["pedidos"])).toBe("1 sección")
    expect(badgePermisos("superadmin", ["pedidos"])).toBeNull()
  })

  it("cambio de rol en el editor: operator->admin conserva y avisa; hacia superadmin pasa a NULL", () => {
    const f = permisosFormDesde(["inbox", "pedidos"], true)
    expect(permisosTrasCambioDeRol(f, "operator", "admin")).toEqual({ form: f, aviso: AVISO_LISTA_CONSERVADA })
    expect(permisosTrasCambioDeRol(f, "admin", "superadmin")).toEqual({ form: porRol, aviso: null })
    expect(permisosTrasCambioDeRol(porRol, "operator", "admin").aviso).toBeNull()
  })

  it("casilla fuera del techo: deshabilitada con motivo; la ya otorgada se puede quitar (spec)", () => {
    const actor = { role: "admin", seccionesPermitidas: ["pedidos"], verCostos: false }
    expect(estadoCasilla(actor, "pedidos", false)).toEqual({ disabled: false, motivo: null })
    expect(estadoCasilla(actor, "catalogo", false)).toEqual({ disabled: true, motivo: MOTIVO_FUERA_DE_TECHO })
    expect(estadoCasilla(actor, "inbox", true).disabled).toBe(false)
    expect(estadoCasillaCostos(actor, false).disabled).toBe(true)
    expect(estadoCasillaCostos(actor, true).disabled).toBe(false)
    expect(estadoCasilla({ role: "superadmin" }, "catalogo", false).disabled).toBe(false)
  })

  it("avisa el techo antes de guardar (p. ej. Restablecer que suma secciones)", () => {
    const actor = { role: "admin", seccionesPermitidas: ["pedidos"], verCostos: false }
    const original = { role: "admin", ...permisosFormDesde(["pedidos"], false) }
    expect(errorTechoPermisos(actor, original, "admin", { secciones: null, verCostos: false })).not.toBeNull()
    expect(errorTechoPermisos(actor, original, "admin", { secciones: [], verCostos: false })).toBeNull()
  })

  it("grupos del menú, sin las ocultas por flag", () => {
    const grupos = seccionesPorGrupo(["compras"])
    expect(grupos.map((g) => g.grupo)).toEqual(["Operación", "Datos"])
    expect(grupos[0].secciones.map((s) => s.clave)).toEqual(["inbox", "pedidos", "comprobantes"])
  })
})
