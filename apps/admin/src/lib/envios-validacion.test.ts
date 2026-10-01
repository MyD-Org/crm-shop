import { describe, expect, it } from "vitest"
import { ENVIO_DEFAULT, textoPreview, validarEnvio } from "@/lib/envios-validacion"

const base = { domicilioActivo: true, gratisActivo: false }

describe("validarEnvio", () => {
  it("gratis No no exige nada más", () => {
    const v = validarEnvio(base)
    expect(v).toEqual({
      ok: true,
      envio: { domicilioActivo: true, gratisActivo: false, alcance: null, provincias: [], minimoModo: null, minimo: null },
    })
  })

  it("rechaza un cuerpo que no es objeto o con booleanos ausentes", () => {
    expect(validarEnvio(null)).toMatchObject({ ok: false, campo: "body" })
    expect(validarEnvio({ gratisActivo: false })).toMatchObject({ ok: false, campo: "domicilioActivo" })
    expect(validarEnvio({ domicilioActivo: true })).toMatchObject({ ok: false, campo: "gratisActivo" })
    expect(validarEnvio({ domicilioActivo: "si", gratisActivo: false })).toMatchObject({ ok: false, campo: "domicilioActivo" })
  })

  it("gratis Sí sin alcance → error", () => {
    expect(validarEnvio({ ...base, gratisActivo: true, minimoModo: "sin_minimo" })).toEqual({
      ok: false,
      campo: "alcance",
      error: "Seleccione el alcance del envío gratis.",
    })
  })

  it("gratis Sí sin modo de mínimo → error", () => {
    expect(validarEnvio({ ...base, gratisActivo: true, alcance: "pais" })).toEqual({
      ok: false,
      campo: "minimoModo",
      error: "Seleccione si el envío gratis tiene monto mínimo.",
    })
  })

  it("alcance 'provincias' sin provincias → mensaje en usted", () => {
    expect(validarEnvio({ ...base, gratisActivo: true, alcance: "provincias", provincias: [], minimoModo: "sin_minimo" })).toEqual({
      ok: false,
      campo: "provincias",
      error: "Seleccione al menos una provincia.",
    })
  })

  it.each([0, -5, "", null, undefined, "abc", "0"])("'desde' con monto %j → error", (monto) => {
    expect(validarEnvio({ ...base, gratisActivo: true, alcance: "pais", minimoModo: "desde", minimo: monto })).toEqual({
      ok: false,
      campo: "minimo",
      error: "Ingrese un monto mayor a cero.",
    })
  })

  it("'sin_minimo' ignora el monto (incluso uno inválido)", () => {
    const v = validarEnvio({ ...base, gratisActivo: true, alcance: "pais", minimoModo: "sin_minimo", minimo: -3 })
    expect(v).toMatchObject({ ok: true, envio: { minimoModo: "sin_minimo", minimo: null } })
  })

  it("'desde' acepta número o texto y guarda el monto", () => {
    const a = validarEnvio({ ...base, gratisActivo: true, alcance: "pais", minimoModo: "desde", minimo: 100000 })
    const b = validarEnvio({ ...base, gratisActivo: true, alcance: "pais", minimoModo: "desde", minimo: "100000,50" })
    expect(a).toMatchObject({ ok: true, envio: { minimo: 100000 } })
    expect(b).toMatchObject({ ok: true, envio: { minimo: 100000.5 } })
  })

  it("provincias fuera del catálogo → error", () => {
    const v = validarEnvio({ ...base, gratisActivo: true, alcance: "provincias", provincias: ["Misiones", "Narnia"], minimoModo: "sin_minimo" })
    expect(v).toMatchObject({ ok: false, campo: "provincias" })
    expect((v as { error: string }).error).toBe("Una de las provincias indicadas no es válida.")
  })

  it("guarda las provincias como claveProvincia, sin duplicados", () => {
    const v = validarEnvio({
      ...base,
      gratisActivo: true,
      alcance: "provincias",
      provincias: ["Misiones", "Córdoba", "misiones", "Ciudad Autónoma de Buenos Aires"],
      minimoModo: "desde",
      minimo: 100000,
    })
    expect(v).toMatchObject({
      ok: true,
      envio: { provincias: ["misiones", "cordoba", "ciudadautonomadebuenosaires"] },
    })
  })

  it("con gratis No conserva lo cargado si es válido y descarta lo inválido", () => {
    const conserva = validarEnvio({ ...base, alcance: "provincias", provincias: ["Misiones"], minimoModo: "desde", minimo: 5000 })
    expect(conserva).toMatchObject({
      ok: true,
      envio: { gratisActivo: false, alcance: "provincias", provincias: ["misiones"], minimoModo: "desde", minimo: 5000 },
    })
    const descarta = validarEnvio({ ...base, alcance: "raro", minimoModo: "desde", minimo: 0 })
    expect(descarta).toMatchObject({ ok: true, envio: { alcance: null, minimoModo: "desde", minimo: null } })
  })

  it("alcance 'pais' no guarda provincias", () => {
    const v = validarEnvio({ ...base, gratisActivo: true, alcance: "pais", provincias: ["Misiones"], minimoModo: "sin_minimo" })
    expect(v).toMatchObject({ ok: true, envio: { alcance: "pais", provincias: [] } })
  })

  it("domicilio inactivo con gratis Sí es válido (el Shop no ofrece envío)", () => {
    const v = validarEnvio({ domicilioActivo: false, gratisActivo: true, alcance: "pais", minimoModo: "sin_minimo" })
    expect(v).toMatchObject({ ok: true, envio: { domicilioActivo: false, gratisActivo: true } })
  })

  it("el default coincide con la migración: domicilio Sí, gratis No", () => {
    expect(ENVIO_DEFAULT).toEqual({ domicilioActivo: true, gratisActivo: false, alcance: null, provincias: [], minimoModo: null, minimo: null })
  })
})

describe("textoPreview", () => {
  it("gratis apagado", () => {
    expect(textoPreview(ENVIO_DEFAULT)).toBe("Envío gratis: no. El envío a domicilio es con costo a coordinar.")
  })
  it("domicilio inactivo", () => {
    expect(textoPreview({ ...ENVIO_DEFAULT, domicilioActivo: false })).toBe("No se ofrece envío a domicilio: solo retiro en el local.")
  })
  it("provincias con mínimo", () => {
    expect(
      textoPreview({ ...ENVIO_DEFAULT, gratisActivo: true, alcance: "provincias", provincias: ["misiones"], minimoModo: "desde", minimo: 100000 }),
    ).toBe("Gratis en Misiones desde $100.000; en el resto, costo a coordinar.")
  })
  it("todo el país sin mínimo", () => {
    expect(textoPreview({ ...ENVIO_DEFAULT, gratisActivo: true, alcance: "pais", minimoModo: "sin_minimo" })).toBe(
      "Gratis en todo el país, sin monto mínimo.",
    )
  })
  it("varias provincias se listan con 'y'", () => {
    expect(
      textoPreview({ ...ENVIO_DEFAULT, gratisActivo: true, alcance: "provincias", provincias: ["misiones", "corrientes", "chaco"], minimoModo: "sin_minimo" }),
    ).toBe("Gratis en Misiones, Corrientes y Chaco sin monto mínimo; en el resto, costo a coordinar.")
  })
  it("provincias vacías: nunca gratis", () => {
    expect(textoPreview({ ...ENVIO_DEFAULT, gratisActivo: true, alcance: "provincias", provincias: [], minimoModo: "sin_minimo" })).toBe(
      "Todavía no hay provincias seleccionadas: el envío no será gratis en ninguna.",
    )
  })
})
