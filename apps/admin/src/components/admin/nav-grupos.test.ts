import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { SECCIONES, SECCIONES_TILDABLES, SECCION_POR_CLAVE, seccionesVisibles, type GrupoSeccion } from "@/lib/secciones"

// El menú de AdminShell sale del catálogo de secciones (lib/secciones.ts): estos tests fijan el
// catálogo importado (orden, grupos, defaults por rol, flags) y, por FUENTE (esta app no tiene
// jsdom), que AdminShell deriva NAV del catálogo y filtra con la lista calculada en el servidor.
const fuente = readFileSync(fileURLToPath(new URL("./AdminShell.tsx", import.meta.url)), "utf8")
const TODO = { compras: true, usagePanel: true }

/** Grupos con al menos una entrada visible, en orden y sin repetir (lo que dibuja SideNav). */
function gruposVisibles(visibles: readonly string[]): GrupoSeccion[] {
  const grupos = SECCIONES.filter((s) => visibles.includes(s.clave)).map((s) => s.grupo)
  return grupos.filter((g, i) => i === 0 || grupos[i - 1] !== g)
}

describe("menú por grupos (catálogo de secciones)", () => {
  it("los grupos van contiguos, en orden Operación → Datos → Administración", () => {
    const grupos = SECCIONES.map((s) => s.grupo)
    const distintos = grupos.filter((g, i) => i === 0 || grupos[i - 1] !== g)
    expect(distintos).toEqual(["Operación", "Datos", "Administración"])
  })

  it("Configuración no existe como sección", () => {
    expect(SECCIONES.some((s) => s.href === "/admin/configuracion" || s.label === "Configuración")).toBe(false)
  })

  it("Sucursales, Envíos, Pagos y cuotas, Horarios, Chat de la tienda y Tienda online: tildables del grupo Datos, admin+ por defecto", () => {
    for (const clave of ["sucursales", "envios", "cuotas", "horarios", "chat-tienda", "tienda-online"] as const) {
      const s = SECCION_POR_CLAVE[clave]
      expect(s.grupo, clave).toBe("Datos")
      expect(s.tildable, clave).toBe(true)
      expect(s.rolMin, clave).toBe("admin")
    }
  })

  it("las no tildables son exactamente Plantillas, Usuarios, Seguridad y Uso del bot", () => {
    expect(SECCIONES.filter((s) => !s.tildable).map((s) => s.clave)).toEqual(["plantillas", "usuarios", "seguridad", "uso"])
    expect(SECCIONES_TILDABLES).toHaveLength(13)
  })

  it("el operador por defecto ve sólo Mensajes y Seguridad", () => {
    expect(seccionesVisibles({ role: "operator" }, TODO)).toEqual(["inbox", "seguridad"])
    expect(gruposVisibles(seccionesVisibles({ role: "operator" }, TODO))).toEqual(["Operación", "Administración"])
  })

  it("el rol «compras» ve SÓLO Compras (aunque tenga una lista cargada)", () => {
    expect(seccionesVisibles({ role: "compras", seccionesPermitidas: ["pedidos"] }, TODO)).toEqual(["compras"])
  })

  it("con el flag apagado «Compras» se oculta también para el rol compras (el flag se evalúa antes que el rol)", () => {
    expect(seccionesVisibles({ role: "compras" }, { ...TODO, compras: false })).toEqual([])
    expect(seccionesVisibles({ role: "admin" }, { ...TODO, compras: false })).not.toContain("compras")
  })

  it("«Compras» está en Operación, admin+ por defecto; el operador no la ve", () => {
    expect(SECCION_POR_CLAVE.compras.grupo).toBe("Operación")
    expect(seccionesVisibles({ role: "admin" }, TODO)).toContain("compras")
    expect(seccionesVisibles({ role: "operator" }, TODO)).not.toContain("compras")
  })

  it("un grupo sin entradas visibles no se muestra", () => {
    expect(gruposVisibles(seccionesVisibles({ role: "admin", seccionesPermitidas: ["catalogo"] }, TODO))).toEqual(["Datos", "Administración"])
  })
})

describe("AdminShell (fuente)", () => {
  it("NAV se deriva del catálogo y cada sección tiene su ícono", () => {
    expect(fuente).toContain("const NAV = SECCIONES.map(")
    expect(fuente).toContain("const ICONOS: Record<SeccionClave, React.ReactNode>")
  })

  it("el filtro usa la lista de secciones visibles calculada en el servidor, sin política propia", () => {
    const filtro = fuente.slice(fuente.indexOf("const visibleNav"), fuente.indexOf("const visibleNav") + 200)
    expect(filtro).toContain("visibles.has(item.clave)")
    expect(fuente).toContain("new Set(seccionesVisibles)")
    expect(fuente).not.toMatch(/\b(roleRank|minRole)\b/)
  })

  it("el rol «compras» no consulta contadores ni conversaciones pendientes", () => {
    expect(fuente).toContain("usePendingCounts(!esCompras)")
    expect(fuente).toMatch(/if \(esCompras\) return true/)
  })
})
