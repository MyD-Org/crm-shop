import { describe, expect, it } from "vitest"
import { estadoCampania, validarCampania } from "./campanias-validar"

const base = {
  nombre: "Black Friday",
  inicio: "2026-11-27T00:00:00-03:00",
  fin: "2026-11-30T23:59:00-03:00",
  reglas: [{ alcance: { tipo: "marca", marca: "acme" }, pct: 20 }],
}

const errores = (e: unknown) => {
  const r = validarCampania(e)
  return r.ok ? [] : r.errores
}

describe("validarCampania", () => {
  it("una campaña válida pasa, con la etiqueta por defecto = nombre y la marca normalizada", () => {
    const r = validarCampania({ ...base, reglas: [{ alcance: { tipo: "marca", marca: " ACME " }, pct: 20 }] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.etiqueta).toBe("Black Friday")
    expect(r.valor.reglas[0].alcance).toEqual({ tipo: "marca", marca: "acme" })
  })

  it("hastaAgotarStock: false por defecto, true si se manda y error si no es booleano", () => {
    const sin = validarCampania(base)
    expect(sin.ok && sin.valor.hastaAgotarStock).toBe(false)
    const con = validarCampania({ ...base, hastaAgotarStock: true })
    expect(con.ok && con.valor.hastaAgotarStock).toBe(true)
    expect(errores({ ...base, hastaAgotarStock: "sí" })).toContain("Indique si la campaña es hasta agotar stock.")
  })

  it("fin igual al inicio es un error", () => {
    expect(errores({ ...base, fin: base.inicio })).toContain("La fecha de fin debe ser posterior al inicio.")
  })

  it("fechas sin zona horaria o inválidas son un error", () => {
    expect(errores({ ...base, inicio: "2026-11-27T00:00:00" })).toContain("Indique una fecha de inicio válida.")
    expect(errores({ ...base, fin: "mañana" })).toContain("Indique una fecha de fin válida.")
  })

  it("nombre vacío o largo y etiqueta larga son errores", () => {
    expect(errores({ ...base, nombre: "  " })).toContain("Ingrese un nombre para la campaña.")
    expect(errores({ ...base, nombre: "x".repeat(81) })).toContain("El nombre admite hasta 80 caracteres.")
    expect(errores({ ...base, etiqueta: "x".repeat(25) })).toContain("La etiqueta admite hasta 24 caracteres.")
  })

  it("sin reglas es un error", () => {
    expect(errores({ ...base, reglas: [] })).toContain("Agregue al menos una regla.")
  })

  it("pct fuera de 0..90 o no entero es un error", () => {
    expect(errores({ ...base, reglas: [{ alcance: { tipo: "marca", marca: "acme" }, pct: 95 }] })).toContain(
      "El descuento debe ser un número entero entre 0 y 90.",
    )
    expect(errores({ ...base, reglas: [{ alcance: { tipo: "marca", marca: "acme" }, pct: 12.5 }] })).toContain(
      "El descuento debe ser un número entero entre 0 y 90.",
    )
  })

  it("mínimo de unidades: entero entre 2 y 999, en cualquier tipo de regla y nunca con límite", () => {
    const marca = (extra: object) => ({ ...base, reglas: [{ alcance: { tipo: "marca", marca: "acme" }, pct: 10, ...extra }] })
    const ok = validarCampania(marca({ minimo: 6 }))
    expect(ok.ok && ok.valor.reglas[0].minimo).toBe(6)
    const sin = validarCampania(base)
    expect(sin.ok && sin.valor.reglas[0].minimo).toBe(null)
    for (const minimo of [1, 0, 2.5, 1000, "6"]) {
      expect(errores(marca({ minimo }))).toContain("La cantidad mínima debe ser un número entero entre 2 y 999.")
    }
    expect(
      errores({ ...base, reglas: [{ alcance: { tipo: "producto", alegraId: "1" }, pct: 10, unidades: 50, minimo: 4 }] }),
    ).toContain("Una regla no puede tener límite de unidades y cantidad mínima a la vez.")
  })

  it("unidades sólo en reglas de producto, entero >= 1", () => {
    expect(
      errores({ ...base, reglas: [{ alcance: { tipo: "marca", marca: "acme" }, pct: 20, unidades: 5 }] }),
    ).toContain("El límite de unidades sólo se puede indicar en reglas de producto.")
    expect(
      errores({ ...base, reglas: [{ alcance: { tipo: "producto", alegraId: "1" }, pct: 20, unidades: 0 }] }),
    ).toContain("El límite de unidades debe ser un número entero mayor que 0.")
    const ok = validarCampania({ ...base, reglas: [{ alcance: { tipo: "producto", alegraId: "1" }, pct: 20, unidades: 5 }] })
    expect(ok.ok && ok.valor.reglas[0].unidades).toBe(5)
  })

  it("reglas duplicadas para el mismo objetivo son un error", () => {
    expect(
      errores({
        ...base,
        reglas: [
          { alcance: { tipo: "marca", marca: "acme" }, pct: 20 },
          { alcance: { tipo: "marca", marca: " Acme" }, pct: 10 },
        ],
      }),
    ).toContain("Hay reglas repetidas para el mismo producto, marca o categoría.")
  })

  it("alcance desconocido o sin objetivo es un error", () => {
    expect(errores({ ...base, reglas: [{ alcance: { tipo: "tag", id: "x" }, pct: 20 }] })).toContain(
      "Cada regla debe indicar un producto, una marca o una categoría.",
    )
    expect(errores({ ...base, reglas: [{ alcance: { tipo: "categoria", categoriaId: "" }, pct: 20 }] })).toContain(
      "Cada regla debe indicar un producto, una marca o una categoría.",
    )
  })
})

describe("estadoCampania", () => {
  const c = { inicio: new Date("2026-11-27T03:00:00Z"), fin: new Date("2026-12-01T03:00:00Z") }
  it("antes del inicio: programada", () => {
    expect(estadoCampania(c, new Date("2026-11-27T02:59:59Z"))).toBe("programada")
  })
  it("en el inicio: activa", () => {
    expect(estadoCampania(c, c.inicio)).toBe("activa")
  })
  it("en el fin: terminada (fin exclusivo)", () => {
    expect(estadoCampania(c, c.fin)).toBe("terminada")
  })
})
