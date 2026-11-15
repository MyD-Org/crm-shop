import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

// Test a nivel FUENTE (esta app no tiene jsdom y `NAV` no se exporta): fija la partición del
// menú en Operación / Datos / Administración y que Configuración ya no exista como entrada
// (sus pestañas pasaron a Sucursales, Pagos y cuotas y Horarios).
const fuente = readFileSync(fileURLToPath(new URL("./AdminShell.tsx", import.meta.url)), "utf8")
const entradas = fuente.split("\n").filter((l) => /^\s*\{ href: "\/admin\//.test(l))
const grupoDe = (l: string) => /group: "([^"]+)"/.exec(l)?.[1]

describe("AdminShell: menú por grupos", () => {
  it("toda entrada tiene grupo y los grupos van contiguos, en orden Operación → Datos → Administración", () => {
    const grupos = entradas.map(grupoDe)
    expect(grupos.every(Boolean)).toBe(true)
    const distintos = grupos.filter((g, i) => i === 0 || grupos[i - 1] !== g)
    expect(distintos).toEqual(["Operación", "Datos", "Administración"])
  })

  it("Configuración desapareció del menú", () => {
    expect(entradas.some((l) => l.includes('"/admin/configuracion"'))).toBe(false)
    expect(fuente).not.toContain('label: "Configuración"')
  })

  it("Sucursales, Envíos, Pagos y cuotas, Horarios, Chat de la tienda y Tienda online son entradas propias del grupo Datos, sólo admin+", () => {
    for (const href of ["/admin/sucursales", "/admin/envios", "/admin/cuotas", "/admin/horarios", "/admin/chat-tienda", "/admin/tienda-online"]) {
      const entrada = entradas.filter((l) => l.includes(`href: "${href}"`))
      expect(entrada, href).toHaveLength(1)
      expect(grupoDe(entrada[0]), href).toBe("Datos")
      expect(entrada[0], href).toContain('minRole: "admin"')
    }
  })

  it("el operador sólo ve Mensajes y Seguridad", () => {
    const sinRol = entradas.filter((l) => !l.includes("minRole"))
    expect(sinRol).toHaveLength(2)
    expect(sinRol[0]).toContain('"/admin/inbox"')
    expect(sinRol[1]).toContain('"/admin/seguridad"')
  })

  it("el rol «compras» ve SÓLO las entradas con acceso «compras» (allow-list, sin importar minRole)", () => {
    expect(fuente).toContain('if (esCompras) return item.acceso === "compras"')
    // Esa línea tiene que ser lo primero que decide el filtro: antes de minRole y de flag.
    const filtro = fuente.slice(fuente.indexOf("const visibleNav"))
    expect(filtro.indexOf("esCompras")).toBeLessThan(filtro.indexOf("minRole"))
    // Ninguna entrada que no sea de Compras puede abrirse a ese rol.
    const conAcceso = entradas.filter((l) => l.includes("acceso:"))
    for (const l of conAcceso) expect(l).toContain('"/admin/compras"')
  })

  it("el rol «compras» no consulta contadores ni conversaciones pendientes", () => {
    expect(fuente).toContain("usePendingCounts(!esCompras)")
    expect(fuente).toMatch(/if \(esCompras\) return true/)
  })
})
