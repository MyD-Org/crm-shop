import { describe, expect, it } from "vitest"
import { roleRank } from "@/lib/roles"
import {
  SECCIONES,
  SECCIONES_TILDABLES,
  SECCION_POR_CLAVE,
  autorizaSeccion,
  primeraSeccionVisible,
  seccionesVisibles,
  sinCampos,
  costosPorDefecto,
  normalizarSecciones,
  puedeVerCostos,
  puedeVerSeccion,
  seccionesEfectivas,
  seccionesPorDefecto,
  seccionesTrasCambioDeRol,
  verCostosTrasCambioDeRol,
  type SeccionClave,
} from "@/lib/secciones"

const ROLES = ["operator", "admin", "superadmin", "compras"] as const
const TILDABLES: SeccionClave[] = [
  "inbox",
  "pedidos",
  "comprobantes",
  "compras",
  "catalogo",
  "clientes-tienda",
  "sucursales",
  "envios",
  "cuotas",
  "horarios",
  "chat-tienda",
  "tienda-online",
  "etiquetas",
]

describe("catálogo", () => {
  it("13 tildables y 4 fijas, claves únicas", () => {
    expect(SECCIONES_TILDABLES.map((s) => s.clave)).toEqual(TILDABLES)
    expect(SECCIONES.filter((s) => !s.tildable).map((s) => s.clave)).toEqual(["plantillas", "usuarios", "seguridad", "uso"])
    expect(new Set(SECCIONES.map((s) => s.clave)).size).toBe(SECCIONES.length)
    for (const s of SECCIONES) expect(SECCION_POR_CLAVE[s.clave]).toBe(s)
  })

  it("grupos contiguos en orden Operación -> Datos -> Administración", () => {
    const grupos = SECCIONES.map((s) => s.grupo).filter((g, i, a) => i === 0 || a[i - 1] !== g)
    expect(grupos).toEqual(["Operación", "Datos", "Administración"])
  })

  it("sólo Compras es del rol lateral", () => {
    expect(SECCIONES.filter((s) => s.rolCompras).map((s) => s.clave)).toEqual(["compras"])
  })
})

// Golden de regresión cero: el NAV de AdminShell al momento de 0106 (href, minRole, acceso), y su
// regla de filtrado (sin flags: con los flags prendidos). Con las columnas NULL, la política nueva
// MUST dar exactamente lo mismo para los 4 roles.
// Regla de `canSeeCosts` (roles.ts) antes de retirarla en S2a, congelada para el golden de costos.
const canSeeCostsPrevio = (role: string): boolean => roleRank(role) >= 1

const NAV_PREVIO: { href: string; minRole?: "admin" | "superadmin"; acceso?: "compras" }[] = [
  { href: "/admin/inbox" },
  { href: "/admin/pedidos", minRole: "admin" },
  { href: "/admin/comprobantes", minRole: "admin" },
  { href: "/admin/compras", minRole: "admin", acceso: "compras" },
  { href: "/admin/catalogo", minRole: "admin" },
  { href: "/admin/clientes-tienda", minRole: "admin" },
  { href: "/admin/sucursales", minRole: "admin" },
  { href: "/admin/envios", minRole: "admin" },
  { href: "/admin/cuotas", minRole: "admin" },
  { href: "/admin/horarios", minRole: "admin" },
  { href: "/admin/chat-tienda", minRole: "admin" },
  { href: "/admin/tienda-online", minRole: "admin" },
  { href: "/admin/etiquetas", minRole: "admin" },
  { href: "/admin/plantillas", minRole: "superadmin" },
  { href: "/admin/usuarios", minRole: "admin" },
  { href: "/admin/seguridad" },
  { href: "/admin/uso", minRole: "superadmin" },
]

function reglaPrevia(role: string, item: (typeof NAV_PREVIO)[number]): boolean {
  if (role === "compras") return item.acceso === "compras"
  if (item.minRole && roleRank(role) < roleRank(item.minRole)) return false
  return true
}

describe("golden: columnas NULL == reglas vigentes", () => {
  it("el catálogo cubre exactamente las entradas del NAV previo, en el mismo orden", () => {
    expect(SECCIONES.map((s) => s.href)).toEqual(NAV_PREVIO.map((n) => n.href))
  })

  for (const role of ROLES) {
    for (const item of NAV_PREVIO) {
      it(`${role} · ${item.href}`, () => {
        const s = SECCIONES.find((x) => x.href === item.href)!
        expect(puedeVerSeccion({ role, seccionesPermitidas: null, verCostos: null }, s.clave)).toBe(reglaPrevia(role, item))
        // undefined (fixtures viejos del guard) se comporta como NULL
        expect(puedeVerSeccion({ role }, s.clave)).toBe(reglaPrevia(role, item))
      })
    }
    it(`${role} · costos NULL == canSeeCosts previo`, () => {
      expect(puedeVerCostos({ role, verCostos: null })).toBe(canSeeCostsPrevio(role))
      expect(costosPorDefecto(role)).toBe(canSeeCostsPrevio(role))
    })
  }
})

describe("puedeVerSeccion", () => {
  it("operador sin lista: sólo inbox de las tildables, y seguridad", () => {
    const u = { role: "operator", seccionesPermitidas: null }
    expect(TILDABLES.filter((c) => puedeVerSeccion(u, c))).toEqual(["inbox"])
    expect(puedeVerSeccion(u, "seguridad")).toBe(true)
    expect(puedeVerSeccion(u, "usuarios")).toBe(false)
  })

  it("admin sin lista: todas las tildables; plantillas y uso no", () => {
    const u = { role: "admin", seccionesPermitidas: null }
    expect(TILDABLES.every((c) => puedeVerSeccion(u, c))).toBe(true)
    expect(puedeVerSeccion(u, "plantillas")).toBe(false)
    expect(puedeVerSeccion(u, "uso")).toBe(false)
  })

  it("lista explícita reemplaza al default", () => {
    const u = { role: "admin", seccionesPermitidas: ["pedidos", "catalogo"] }
    expect(puedeVerSeccion(u, "etiquetas")).toBe(false)
    expect(puedeVerSeccion(u, "pedidos")).toBe(true)
    expect(puedeVerSeccion(u, "catalogo")).toBe(true)
    expect(seccionesEfectivas(u)).toEqual(["pedidos", "catalogo", "usuarios", "seguridad"])
  })

  it("lista vacía: ninguna tildable, pero usuarios (admin) y seguridad siguen", () => {
    const u = { role: "admin", seccionesPermitidas: [] }
    expect(TILDABLES.some((c) => puedeVerSeccion(u, c))).toBe(false)
    expect(puedeVerSeccion(u, "usuarios")).toBe(true)
    expect(puedeVerSeccion(u, "seguridad")).toBe(true)
  })

  it("operador con sección extra la ve (el rango ya no bloquea)", () => {
    const u = { role: "operator", seccionesPermitidas: ["inbox", "pedidos"] }
    expect(puedeVerSeccion(u, "pedidos")).toBe(true)
    expect(puedeVerSeccion(u, "catalogo")).toBe(false)
  })

  it("clave no tildable o desconocida en la lista no concede", () => {
    const u = { role: "operator", seccionesPermitidas: ["plantillas", "xyz", "pedidos", "usuarios"] }
    expect(seccionesEfectivas(u)).toEqual(["pedidos", "seguridad"])
  })

  it("superadmin con lista residual ve todo", () => {
    const u = { role: "superadmin", seccionesPermitidas: ["inbox"] }
    expect(seccionesEfectivas(u)).toEqual(SECCIONES.map((s) => s.clave))
  })

  it("compras ignora la lista: sólo Compras", () => {
    const u = { role: "compras", seccionesPermitidas: ["pedidos"] }
    expect(seccionesEfectivas(u)).toEqual(["compras"])
  })

  it("rol desconocido: nada (ni seguridad)", () => {
    expect(seccionesEfectivas({ role: "root", seccionesPermitidas: null })).toEqual([])
    expect(seccionesEfectivas({ role: "", seccionesPermitidas: ["inbox"] })).toEqual([])
  })

  it("clave desconocida: falso", () => {
    expect(puedeVerSeccion({ role: "superadmin" }, "xyz" as SeccionClave)).toBe(false)
  })
})

describe("seccionesPorDefecto", () => {
  it("por rol, sólo tildables", () => {
    expect(seccionesPorDefecto("operator")).toEqual(["inbox"])
    expect(seccionesPorDefecto("admin")).toEqual(TILDABLES)
    expect(seccionesPorDefecto("superadmin")).toEqual(TILDABLES)
    expect(seccionesPorDefecto("compras")).toEqual(["compras"])
    expect(seccionesPorDefecto("root")).toEqual([])
  })
})

describe("puedeVerCostos", () => {
  it("default conservado: admin sí, operador no", () => {
    expect(puedeVerCostos({ role: "admin", verCostos: null })).toBe(true)
    expect(puedeVerCostos({ role: "operator", verCostos: null })).toBe(false)
  })
  it("explícito manda para operator/admin", () => {
    expect(puedeVerCostos({ role: "operator", verCostos: true })).toBe(true)
    expect(puedeVerCostos({ role: "admin", verCostos: false })).toBe(false)
  })
  it("superadmin siempre; compras y desconocido nunca", () => {
    expect(puedeVerCostos({ role: "superadmin", verCostos: false })).toBe(true)
    expect(puedeVerCostos({ role: "compras", verCostos: true })).toBe(false)
    expect(puedeVerCostos({ role: "root", verCostos: true })).toBe(false)
  })
})

describe("normalizarSecciones", () => {
  it("únicas, tildables conocidas, orden de catálogo", () => {
    expect(normalizarSecciones(["etiquetas", "pedidos", "pedidos", "usuarios", "xyz", "inbox"])).toEqual([
      "inbox",
      "pedidos",
      "etiquetas",
    ])
    expect(normalizarSecciones([])).toEqual([])
  })
})

describe("cambio de rol", () => {
  it("operador con lista asciende a admin: conserva exactamente la lista", () => {
    expect(seccionesTrasCambioDeRol("operator", "admin", ["inbox", "pedidos"])).toEqual(["inbox", "pedidos"])
  })
  it("entre operator y admin recorta claves inválidas", () => {
    expect(seccionesTrasCambioDeRol("admin", "operator", ["usuarios", "pedidos", "xyz"])).toEqual(["pedidos"])
  })
  it("NULL sigue NULL", () => {
    expect(seccionesTrasCambioDeRol("operator", "admin", null)).toBeNull()
    expect(verCostosTrasCambioDeRol("operator", "admin", null)).toBeNull()
  })
  it("hacia superadmin o compras: ambos NULL", () => {
    expect(seccionesTrasCambioDeRol("admin", "superadmin", ["pedidos"])).toBeNull()
    expect(verCostosTrasCambioDeRol("admin", "superadmin", false)).toBeNull()
    expect(seccionesTrasCambioDeRol("operator", "compras", ["inbox"])).toBeNull()
    expect(verCostosTrasCambioDeRol("operator", "compras", true)).toBeNull()
  })
  it("desde superadmin o compras: ambos NULL", () => {
    expect(seccionesTrasCambioDeRol("superadmin", "admin", ["inbox"])).toBeNull()
    expect(verCostosTrasCambioDeRol("superadmin", "admin", true)).toBeNull()
    expect(seccionesTrasCambioDeRol("compras", "operator", ["compras"])).toBeNull()
  })
  it("costos explícitos se conservan entre operator y admin", () => {
    expect(verCostosTrasCambioDeRol("operator", "admin", true)).toBe(true)
    expect(verCostosTrasCambioDeRol("admin", "operator", false)).toBe(false)
  })
  it("mismo rol: sin cambio", () => {
    expect(seccionesTrasCambioDeRol("admin", "admin", ["pedidos"])).toEqual(["pedidos"])
    expect(verCostosTrasCambioDeRol("admin", "admin", false)).toBe(false)
  })
})

describe("autorizaSeccion", () => {
  const encendido = async () => true
  const apagado = async () => false
  it("any-of, rolMin y flag de Compras", async () => {
    expect(await autorizaSeccion({ role: "admin", seccionesPermitidas: ["cuotas"] }, ["catalogo", "cuotas"], undefined, encendido)).toBe(true)
    expect(await autorizaSeccion({ role: "admin", seccionesPermitidas: ["cuotas"] }, "catalogo", undefined, encendido)).toBe(false)
    expect(await autorizaSeccion({ role: "operator" }, "inbox", { rolMin: "admin" }, encendido)).toBe(false)
    expect(await autorizaSeccion({ role: "admin" }, "compras", undefined, apagado)).toBe(false)
    expect(await autorizaSeccion({ role: "admin" }, "compras", undefined, encendido)).toBe(true)
  })
  it("con varias claves alcanza una cuyo flag esté prendido", async () => {
    expect(await autorizaSeccion({ role: "admin" }, ["compras", "pedidos"], undefined, apagado)).toBe(true)
  })
  it("el flag sólo se consulta si hace falta", async () => {
    let llamadas = 0
    const flag = async () => {
      llamadas++
      return true
    }
    await autorizaSeccion({ role: "admin" }, "pedidos", undefined, flag)
    await autorizaSeccion({ role: "operator" }, "compras", undefined, flag)
    expect(llamadas).toBe(0)
  })
})

describe("seccionesVisibles (menú)", () => {
  const todo = { compras: true, usagePanel: true }
  it("operador por defecto: Mensajes y Seguridad", () => {
    expect(seccionesVisibles({ role: "operator" }, todo)).toEqual(["inbox", "seguridad"])
  })
  it("compras: sólo Compras, y nada con el flag apagado", () => {
    expect(seccionesVisibles({ role: "compras" }, todo)).toEqual(["compras"])
    expect(seccionesVisibles({ role: "compras" }, { ...todo, compras: false })).toEqual([])
  })
  it("admin con lista ['catalogo']: Catálogo, Usuarios y Seguridad", () => {
    expect(seccionesVisibles({ role: "admin", seccionesPermitidas: ["catalogo"] }, todo)).toEqual(["catalogo", "usuarios", "seguridad"])
  })
  it("Uso del bot sólo con el flag usagePanel", () => {
    expect(seccionesVisibles({ role: "superadmin" }, todo)).toContain("uso")
    expect(seccionesVisibles({ role: "superadmin" }, { ...todo, usagePanel: false })).not.toContain("uso")
  })
})

describe("primeraSeccionVisible (landing)", () => {
  it("la primera sección de trabajo en el orden del menú", () => {
    expect(primeraSeccionVisible(["inbox", "seguridad"])).toBe("/admin/inbox")
    expect(primeraSeccionVisible(["catalogo", "usuarios", "seguridad"])).toBe("/admin/catalogo")
    expect(primeraSeccionVisible(["seguridad", "pedidos"])).toBe("/admin/pedidos")
  })
  it("sin secciones de trabajo cae en Seguridad", () => {
    expect(primeraSeccionVisible(["usuarios", "seguridad"])).toBe("/admin/seguridad")
    expect(primeraSeccionVisible([])).toBe("/admin/seguridad")
  })
  it("con columnas NULL todo rol jerárquico entra por Mensajes, como antes", () => {
    for (const role of ["operator", "admin", "superadmin"]) {
      expect(primeraSeccionVisible(seccionesVisibles({ role }, { compras: true, usagePanel: true }))).toBe("/admin/inbox")
    }
  })
})

describe("sinCampos", () => {
  it("quita la clave (no la deja en null) y no muta el original", () => {
    const o = { a: 1, costo: 2 }
    const r = sinCampos(o, ["costo"])
    expect("costo" in r).toBe(false)
    expect(o.costo).toBe(2)
  })
})
