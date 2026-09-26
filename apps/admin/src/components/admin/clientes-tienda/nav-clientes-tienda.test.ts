import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

// Test a nivel FUENTE (esta app no tiene jsdom y `NAV` no se exporta), como nav-pedidos: fija
// que "Clientes de la tienda" exista en el sidebar, sin `minRole` ni `flag` (la ve el operador:
// es sólo lectura) y justo después de Pedidos.
const fuente = readFileSync(fileURLToPath(new URL("../AdminShell.tsx", import.meta.url)), "utf8")
const lineas = fuente.split("\n")

describe("AdminShell: entrada Clientes de la tienda", () => {
  const entrada = lineas.filter((l) => l.includes('href: "/admin/clientes-tienda"'))

  it("existe una sola vez, con la etiqueta y el ícono UserRound", () => {
    expect(entrada).toHaveLength(1)
    expect(entrada[0]).toContain('label: "Clientes de la tienda"')
    expect(entrada[0]).toContain("<UserRound")
  })

  it("no tiene rol mínimo ni feature flag: la ve el operador", () => {
    expect(entrada[0]).not.toContain("minRole")
    expect(entrada[0]).not.toContain("flag")
  })

  it("va justo después de Pedidos", () => {
    const entradas = lineas.filter((l) => /^\s*\{ href: "\/admin\//.test(l))
    const i = entradas.findIndex((l) => l.includes('"/admin/pedidos"'))
    expect(entradas[i + 1]).toContain('"/admin/clientes-tienda"')
  })
})
