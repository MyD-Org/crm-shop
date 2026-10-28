import { describe, expect, it } from "vitest"
import { aIsoArgentina, cuerpoCampania, deIsoArgentina, fmtVentana, ROTULO_ESTADO, type FormCampania } from "./campanias-ui"

describe("fechas en hora de Argentina", () => {
  it("aIsoArgentina arma el ISO con -03:00", () => {
    expect(aIsoArgentina("2026-11-27", "00:00")).toBe("2026-11-27T00:00:00-03:00")
  })

  it("deIsoArgentina devuelve fecha y hora de Argentina sea cual sea el offset de entrada", () => {
    expect(deIsoArgentina("2026-11-27T03:00:00.000Z")).toEqual({ fecha: "2026-11-27", hora: "00:00" })
    expect(deIsoArgentina("2026-11-30T23:59:00-03:00")).toEqual({ fecha: "2026-11-30", hora: "23:59" })
  })

  it("fmtVentana: dd/mm hh:mm → dd/mm hh:mm en hora de Argentina", () => {
    expect(fmtVentana("2026-11-27T03:00:00Z", "2026-12-01T02:59:00Z")).toBe("27/11 00:00 → 30/11 23:59")
  })
})

describe("ROTULO_ESTADO", () => {
  it("rótulo y tono de cada estado", () => {
    expect(ROTULO_ESTADO.programada).toEqual({ texto: "Programada", tono: "info" })
    expect(ROTULO_ESTADO.activa).toEqual({ texto: "Activa", tono: "success" })
    expect(ROTULO_ESTADO.terminada).toEqual({ texto: "Terminada", tono: "neutral" })
  })
})

describe("cuerpoCampania", () => {
  const form: FormCampania = {
    nombre: " Black Friday ",
    etiqueta: "",
    inicioFecha: "2026-11-27",
    inicioHora: "00:00",
    finFecha: "2026-11-30",
    finHora: "23:59",
    reglas: [
      { clave: "a", tipo: "marca", marca: "acme", categoriaId: "", producto: null, pct: "20", unidades: "" },
      {
        clave: "b",
        tipo: "producto",
        marca: "",
        categoriaId: "",
        producto: { alegraId: "7", nombre: "Lámpara", code: null },
        pct: "30",
        unidades: "5",
      },
    ],
  }

  it("arma el cuerpo del POST: fechas -03:00, pct entero y sin unidades vacías", () => {
    expect(cuerpoCampania(form)).toEqual({
      nombre: "Black Friday",
      inicio: "2026-11-27T00:00:00-03:00",
      fin: "2026-11-30T23:59:00-03:00",
      reglas: [
        { alcance: { tipo: "marca", marca: "acme" }, pct: 20 },
        { alcance: { tipo: "producto", alegraId: "7" }, pct: 30, unidades: 5 },
      ],
    })
  })

  it("la etiqueta va sólo si se cargó", () => {
    expect(cuerpoCampania({ ...form, etiqueta: "BF" }).etiqueta).toBe("BF")
  })

  it("un % no numérico viaja tal cual para que el servidor diga qué está mal", () => {
    const c = cuerpoCampania({ ...form, reglas: [{ ...form.reglas[0], pct: "veinte" }] })
    expect(c.reglas[0].pct).toBeNaN()
  })
})
