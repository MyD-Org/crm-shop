import { describe, expect, it } from "vitest"
import type { CuentaBancariaDto } from "@/lib/cuentas-bancarias-shop-repo"
import { buildCuentaBancariaAvisoEmail, diffCuenta, enmascararCbu } from "@/lib/cuentas-bancarias-shop-aviso-email"

const base: CuentaBancariaDto = {
  id: "c1",
  alias: "tienda.cobros",
  cbu: "0170099220000067797370",
  banco: "Banco Ejemplo",
  titular: "Empresa Ejemplo SA",
  cuit: "30-12345678-9",
  todasLasSucursales: true,
  sucursalSlugs: [],
  montoMin: null,
  montoMax: null,
  activa: true,
  predeterminada: false,
  orden: 0,
}
const actor = { name: "Ana Pérez", email: "ana@cliente.example" }
const fecha = new Date("2026-11-01T15:30:00Z")
const input = { tenantName: "Tienda Ejemplo", nombreDestinatario: "Luis", actor, fecha }

describe("enmascararCbu", () => {
  it("deja sólo los últimos 4 dígitos", () => {
    expect(enmascararCbu("0170099220000067797370")).toBe("•••• 7370")
    expect(enmascararCbu("")).toBe("(vacío)")
  })
})

describe("diffCuenta", () => {
  it("sin cambios → vacío", () => expect(diffCuenta(base, { ...base })).toEqual([]))
  it("lista sólo los campos que cambiaron, con el CBU enmascarado", () => {
    const d = diffCuenta(base, { ...base, cbu: "0170099220000067791111", titular: "Otro Titular", activa: false })
    expect(d.map((c) => c.etiqueta)).toEqual(["CBU/CVU", "Titular", "Estado"])
    expect(d[0]).toEqual({ etiqueta: "CBU/CVU", antes: "•••• 7370", despues: "•••• 1111" })
  })
  it("detecta un CBU distinto aunque los últimos 4 coincidan", () => {
    expect(diffCuenta(base, { ...base, cbu: "9999999999999999997370" })).toHaveLength(1)
  })
})

describe("buildCuentaBancariaAvisoEmail", () => {
  const nuevo = { ...base, cbu: "0170099220000067791111", alias: "otro.alias" }

  it("edición: actor, fecha, antes → después y advertencia, sin CBU completo", () => {
    const m = buildCuentaBancariaAvisoEmail({ ...input, tipo: "edicion", antes: base, despues: nuevo })!
    expect(m.subject).toBe("Se modificó una cuenta bancaria de la tienda")
    for (const out of [m.html, m.text]) {
      expect(out).toContain("Ana Pérez")
      expect(out).toContain("ana@cliente.example")
      expect(out).toContain("•••• 7370")
      expect(out).toContain("•••• 1111")
      expect(out).toContain("tienda.cobros")
      expect(out).toContain("otro.alias")
      expect(out).toContain("Si no reconoce este cambio, revise la cuenta de inmediato y cambie su contraseña.")
      expect(out).not.toContain("0170099220000067797370")
      expect(out).not.toContain("0170099220000067791111")
    }
    expect(m.text).toContain("1 de noviembre de 2026")
    expect(m.text).toContain("12:30") // hora de Argentina (UTC-3)
  })

  it("edición sin cambios → null (nada que avisar)", () => {
    expect(buildCuentaBancariaAvisoEmail({ ...input, tipo: "edicion", antes: base, despues: { ...base } })).toBeNull()
  })

  it("alta y baja enmascaran y titulan distinto", () => {
    const alta = buildCuentaBancariaAvisoEmail({ ...input, tipo: "alta", despues: base })!
    const baja = buildCuentaBancariaAvisoEmail({ ...input, tipo: "baja", antes: base })!
    expect(alta.subject).toContain("agregó")
    expect(baja.subject).toContain("eliminó")
    expect(alta.text).toContain("•••• 7370")
    expect(baja.text).not.toContain("0170099220000067797370")
  })

  it("escapa HTML en el nombre del actor y neutraliza saltos de línea", () => {
    const m = buildCuentaBancariaAvisoEmail({
      ...input,
      actor: { name: "<b>X</b>\nBcc: a@b.example", email: "x@cliente.example" },
      tipo: "alta",
      despues: base,
    })!
    expect(m.html).not.toContain("<b>X</b>")
    expect(m.html).toContain("&lt;b&gt;X&lt;/b&gt;")
    expect(m.subject).not.toMatch(/\n/)
  })
})
