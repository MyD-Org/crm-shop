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

  it("Sucursales, Pagos y cuotas y Horarios son entradas propias del grupo Datos, sólo admin+", () => {
    for (const href of ["/admin/sucursales", "/admin/cuotas", "/admin/horarios"]) {
      const entrada = entradas.filter((l) => l.includes(`href: "${href}"`))
      expect(entrada, href).toHaveLength(1)
      expect(grupoDe(entrada[0]), href).toBe("Datos")
      expect(entrada[0], href).toContain('minRole: "admin"')
    }
  })

  it("el operador sólo ve Operación y Clientes de la tienda", () => {
    const sinRol = entradas.filter((l) => !l.includes("minRole"))
    expect(sinRol.map(grupoDe)).toEqual(["Operación", "Operación", "Datos"])
    expect(sinRol[2]).toContain('"/admin/clientes-tienda"')
  })
})
