import { describe, it, expect } from "vitest"
import { estadoPromocion, validarPromocion } from "./cupones-validar"

const base = {
  nombre: "Bot Instagram",
  tipo: "unicos",
  prefijo: "LUZ",
  pct: 10,
  envioGratis: false,
  provinciasEnvio: null,
  inicio: "2026-11-01T00:00:00-03:00",
  fin: "2026-12-01T00:00:00-03:00",
  venceDiasDesdeEmision: 7,
  soloPrimeraCompra: true,
  minimo: null,
  medios: null,
  formas: null,
  permiteCuotas: false,
  limiteCanjes: null,
  condiciones: "Sólo primera compra. No acumula con otras promociones.",
}

function errores(e: unknown): string[] {
  const r = validarPromocion(e)
  return r.ok ? [] : r.errores
}

describe("validarPromocion", () => {
  it("acepta una promoción de únicos completa", () => {
    const r = validarPromocion(base)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.valor).toMatchObject({ tipo: "unicos", prefijo: "LUZ", pct: 10, venceDiasDesdeEmision: 7 })
  })

  it("exige nombre", () => {
    expect(errores({ ...base, nombre: " " })).toContain("Ingrese un nombre para la promoción.")
  })

  it("genérica exige código de 3 a 24 caracteres alfanuméricos", () => {
    expect(validarPromocion({ ...base, tipo: "generica", codigo: "" }).ok).toBe(false)
    expect(errores({ ...base, tipo: "generica", codigo: "AB" })).toContain(
      "Ingrese un código de 3 a 24 letras o números.",
    )
    expect(validarPromocion({ ...base, tipo: "generica", codigo: "luz", prefijo: undefined }).ok).toBe(true)
    const r = validarPromocion({ ...base, tipo: "generica", codigo: "apertura10", prefijo: undefined })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.valor.codigo).toBe("APERTURA10")
      expect(r.valor.prefijo).toBeUndefined()
      expect(r.valor.venceDiasDesdeEmision).toBeNull()
    }
  })

  it("únicos exige prefijo de 2 a 8 letras", () => {
    expect(errores({ ...base, prefijo: "l1" })).toContain("Ingrese un prefijo de 2 a 8 letras.")
    const r = validarPromocion({ ...base, prefijo: "luz" })
    expect(r.ok && r.valor.prefijo).toBe("LUZ")
  })

  it("pct entre 1 y 50 o envío gratis", () => {
    expect(errores({ ...base, pct: 51 })).toContain("El descuento debe ser un número entero entre 1 y 50.")
    expect(errores({ ...base, pct: 0 })).toContain("El descuento debe ser un número entero entre 1 y 50.")
    expect(errores({ ...base, pct: 2.5 })).toContain("El descuento debe ser un número entero entre 1 y 50.")
    expect(errores({ ...base, pct: null, envioGratis: false })).toContain("Indique un descuento o envío gratis.")
    expect(validarPromocion({ ...base, pct: null, envioGratis: true }).ok).toBe(true)
  })

  it("fin posterior al inicio, ISO con zona", () => {
    expect(errores({ ...base, inicio: "2026-11-01T00:00:00" })).toContain("Indique una fecha de inicio válida.")
    expect(errores({ ...base, fin: "mañana" })).toContain("Indique una fecha de fin válida.")
    expect(errores({ ...base, fin: base.inicio })).toContain("La fecha de fin debe ser posterior al inicio.")
  })

  it("medios: sólo slugs válidos; formas: del conjunto", () => {
    expect(errores({ ...base, medios: ["Mal Slug"] })).toContain("Hay un medio de pago inválido.")
    expect(errores({ ...base, formas: ["cheque"] })).toContain("Hay una forma de pago inválida.")
    const r = validarPromocion({ ...base, medios: ["transferencia", "a_coordinar"], formas: ["debito", "cuenta_mp"] })
    expect(r.ok && r.valor.medios).toEqual(["transferencia", "a_coordinar"])
  })

  it("provincias: se guardan como clave de provincia conocida", () => {
    const r = validarPromocion({ ...base, envioGratis: true, provinciasEnvio: ["Buenos Aires", "cordoba"] })
    expect(r.ok && r.valor.provinciasEnvio).toEqual(["buenosaires", "cordoba"])
    expect(errores({ ...base, provinciasEnvio: ["Narnia"] })).toContain("Hay una provincia inválida.")
  })

  it("listas vacías equivalen a null (todas)", () => {
    const r = validarPromocion({ ...base, medios: [], formas: [], provinciasEnvio: [] })
    expect(r.ok && [r.valor.medios, r.valor.formas, r.valor.provinciasEnvio]).toEqual([null, null, null])
  })

  it("mínimo, límite y días de vencimiento positivos", () => {
    expect(errores({ ...base, minimo: -1 })).toContain("La compra mínima debe ser un monto mayor que 0.")
    expect(errores({ ...base, limiteCanjes: 0 })).toContain("El límite de canjes debe ser un número entero mayor que 0.")
    expect(errores({ ...base, venceDiasDesdeEmision: 0 })).toContain(
      "Los días de vencimiento deben ser un número entero entre 1 y 365.",
    )
  })

  it("no repite mensajes", () => {
    const es = errores({ ...base, medios: ["X X", "Y Y"] })
    expect(es.filter((m) => m === "Hay un medio de pago inválido.")).toHaveLength(1)
  })
})

describe("estadoPromocion", () => {
  const p = { inicio: new Date("2026-11-01T00:00:00-03:00"), fin: new Date("2026-11-10T00:00:00-03:00"), activa: true }
  it("programada, activa y terminada por fechas (fin exclusivo)", () => {
    expect(estadoPromocion(p, new Date("2026-10-31T23:59:59-03:00"))).toBe("programada")
    expect(estadoPromocion(p, new Date("2026-11-09T23:59:59-03:00"))).toBe("activa")
    expect(estadoPromocion(p, new Date("2026-11-10T00:00:00-03:00"))).toBe("terminada")
  })
  it("pausada gana a activa y a programada; terminada gana a pausada", () => {
    expect(estadoPromocion({ ...p, activa: false }, new Date("2026-11-05T00:00:00-03:00"))).toBe("pausada")
    expect(estadoPromocion({ ...p, activa: false }, new Date("2026-10-01T00:00:00-03:00"))).toBe("pausada")
    expect(estadoPromocion({ ...p, activa: false }, new Date("2026-11-11T00:00:00-03:00"))).toBe("terminada")
  })
})
