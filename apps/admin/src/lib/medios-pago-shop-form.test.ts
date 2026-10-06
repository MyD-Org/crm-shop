import { describe, it, expect } from "vitest"
import type { MedioPagoConAvisos } from "@/lib/medios-pago-shop-repo"
import { aplicarMedioGuardado, cambiosDeCuotas, cuerpoDePrecios, validarFilasCuotas } from "@/lib/medios-pago-shop-form"

const medio = (slug: string, extra: Partial<MedioPagoConAvisos> = {}): MedioPagoConAvisos => ({
  slug,
  nombre: slug,
  instrucciones: "",
  activo: true,
  aplicaRetiro: true,
  aplicaEnvio: true,
  cobroOnline: false,
  orden: 0,
  listaOnlineId: null,
  listaOnlineNombre: null,
  listaOnlineActiva: false,
  condicionesCuotas: [],
  destacarEnCatalogo: false,
  mostrarEnFicha: false,
  avisos: [],
  ...extra,
})

describe("cuerpoDePrecios", () => {
  it("viaja sólo el destacado y la ficha (la lista se enlaza por Precios online)", () => {
    expect(cuerpoDePrecios({ destacarEnCatalogo: true, mostrarEnFicha: true })).toEqual({
      destacarEnCatalogo: true,
      mostrarEnFicha: true,
    })
  })
})

describe("aplicarMedioGuardado", () => {
  it("destacar otro medio desmarca al anterior en la lista local", () => {
    const antes = [medio("aa", { destacarEnCatalogo: true }), medio("bb")]
    const despues = aplicarMedioGuardado(antes, medio("bb", { destacarEnCatalogo: true }))
    expect(despues.map((m) => [m.slug, m.destacarEnCatalogo])).toEqual([
      ["aa", false],
      ["bb", true],
    ])
  })

  it("prender 'Mostrar en ficha' en varios no desmarca a los demás", () => {
    let lista = [medio("aa"), medio("bb"), medio("cc")]
    lista = aplicarMedioGuardado(lista, medio("aa", { mostrarEnFicha: true }))
    lista = aplicarMedioGuardado(lista, medio("bb", { mostrarEnFicha: true }))
    expect(lista.map((m) => m.mostrarEnFicha)).toEqual([true, true, false])
  })

  it("un medio nuevo se agrega y la lista queda por orden", () => {
    const lista = aplicarMedioGuardado([medio("aa", { orden: 1 })], medio("bb", { orden: 0 }))
    expect(lista.map((m) => m.slug)).toEqual(["bb", "aa"])
  })

  it("guardar un medio no destacado no toca al destacado de otro", () => {
    const lista = aplicarMedioGuardado([medio("aa", { destacarEnCatalogo: true }), medio("bb")], medio("bb", { nombre: "Otro" }))
    expect(lista[0].destacarEnCatalogo).toBe(true)
  })
})

describe("cuotas sin interés del medio", () => {
  const LISTA_A = "5b0c0a7e-1d6e-4c1b-8e2a-6c1f4d9a0b11"
  const LISTA_B = "5b0c0a7e-1d6e-4c1b-8e2a-6c1f4d9a0b22"

  it("validarFilasCuotas acepta cantidades enteras de 2 a 24, con lista y sin repetir", () => {
    expect(
      validarFilasCuotas([
        { cuotas: "6", listaId: LISTA_B },
        { cuotas: " 3 ", listaId: LISTA_A },
      ]),
    ).toEqual({
      ok: true,
      filas: [
        { cuotas: 3, listaId: LISTA_A },
        { cuotas: 6, listaId: LISTA_B },
      ],
    })
    expect(validarFilasCuotas([])).toEqual({ ok: true, filas: [] })
  })

  it("rechaza cantidades fuera de rango o no enteras, en usted", () => {
    for (const cuotas of ["", "1", "25", "3,5", "abc", "-3"]) {
      const r = validarFilasCuotas([{ cuotas, listaId: LISTA_A }])
      expect(r).toEqual({ ok: false, error: "Indique una cantidad de cuotas entera, de 2 a 24." })
    }
  })

  it("rechaza repetidas y filas sin lista", () => {
    expect(
      validarFilasCuotas([
        { cuotas: "3", listaId: LISTA_A },
        { cuotas: "3", listaId: LISTA_B },
      ]),
    ).toEqual({ ok: false, error: "No puede repetir la cantidad de cuotas: 3." })
    expect(validarFilasCuotas([{ cuotas: "3", listaId: "" }])).toEqual({
      ok: false,
      error: "Seleccione la lista de precios de cada cantidad de cuotas.",
    })
  })

  it("cambiosDeCuotas: alta, cambio de lista y baja; lo igual no genera cambio", () => {
    const actuales = [
      { cuotas: 3, listaId: LISTA_A },
      { cuotas: 6, listaId: LISTA_A },
      { cuotas: 9, listaId: LISTA_A },
    ]
    const deseadas = [
      { cuotas: 3, listaId: LISTA_A },
      { cuotas: 6, listaId: LISTA_B },
      { cuotas: 12, listaId: LISTA_B },
    ]
    expect(cambiosDeCuotas("mercadopago", actuales, deseadas)).toEqual([
      { op: "setCondicion", medioSlug: "mercadopago", cuotas: 6, listaId: LISTA_B },
      { op: "setCondicion", medioSlug: "mercadopago", cuotas: 12, listaId: LISTA_B },
      { op: "setCondicion", medioSlug: "mercadopago", cuotas: 9, listaId: null },
    ])
    expect(cambiosDeCuotas("mercadopago", actuales, actuales)).toEqual([])
  })
})
