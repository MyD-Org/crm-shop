import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

// Test a nivel FUENTE (esta app no tiene jsdom y `NAV` no se exporta): fija que la entrada
// "Pedidos" del sidebar exista y que NO declare `minRole` ni `flag`, que es lo que la hace
// visible para el operador (ADM-1). Si alguien le agrega `minRole: "admin"`, esto se rompe.
const fuente = readFileSync(fileURLToPath(new URL("../AdminShell.tsx", import.meta.url)), "utf8")
const lineas = fuente.split("\n")

describe("AdminShell: entrada Pedidos", () => {
  const entrada = lineas.filter((l) => l.includes('href: "/admin/pedidos"'))

  it("existe una sola vez, con la etiqueta Pedidos", () => {
    expect(entrada).toHaveLength(1)
    expect(entrada[0]).toContain('label: "Pedidos"')
  })

  it("no tiene rol mínimo ni feature flag: la ve el operador", () => {
    expect(entrada[0]).not.toContain("minRole")
    expect(entrada[0]).not.toContain("flag")
  })

  it("va justo después de Mensajes", () => {
    const entradas = lineas.filter((l) => /^\s*\{ href: "\/admin\//.test(l))
    expect(entradas[0]).toContain('"/admin/inbox"')
    expect(entradas[1]).toContain('"/admin/pedidos"')
  })
})
