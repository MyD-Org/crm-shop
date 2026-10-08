import { describe, it, expect } from "vitest"
import type { MedioPagoConAvisos } from "@/lib/medios-pago-shop-repo"
import { aplicarMedioGuardado, cambiosDeCuotas, cuerpoDeOpciones, cuerpoDePrecios, validarFilasCuotas } from "@/lib/medios-pago-shop-form"

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
  audiencia: "publico",
  chips: [],
  opcionesCobro: ["credito", "debito", "cuenta_mp"],
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
        { cuotas: 3, listaId: LISTA_A, montoMinimo: null, marcas: null },
        { cuotas: 6, listaId: LISTA_B, montoMinimo: null, marcas: null },
      ],
    })
    expect(validarFilasCuotas([])).toEqual({ ok: true, filas: [] })
  })

  it("validarFilasCuotas: el mínimo 'Desde $' es opcional, >= 0 y se normaliza a dos decimales", () => {
    const r = validarFilasCuotas([
      { cuotas: "3", listaId: LISTA_A, montoMinimo: "" },
      { cuotas: "6", listaId: LISTA_A, montoMinimo: " 60000 " },
      { cuotas: "9", listaId: LISTA_A, montoMinimo: "80000,5" },
      { cuotas: "12", listaId: LISTA_A, montoMinimo: "0" },
    ])
    expect(r).toEqual({
      ok: true,
      filas: [
        { cuotas: 3, listaId: LISTA_A, montoMinimo: null, marcas: null },
        { cuotas: 6, listaId: LISTA_A, montoMinimo: "60000.00", marcas: null },
        { cuotas: 9, listaId: LISTA_A, montoMinimo: "80000.50", marcas: null },
        { cuotas: 12, listaId: LISTA_A, montoMinimo: "0.00", marcas: null },
      ],
    })
  })

  it("rechaza un mínimo negativo o que no es un número, en usted", () => {
    for (const montoMinimo of ["-1", "abc", "10.123", "1.000,50", "1e5"]) {
      expect(validarFilasCuotas([{ cuotas: "3", listaId: LISTA_A, montoMinimo }])).toEqual({
        ok: false,
        error: "Indique un monto válido, igual o mayor que cero, o deje 'Desde $' vacío.",
      })
    }
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
      { cuotas: 3, listaId: LISTA_A, montoMinimo: null, marcas: null },
      { cuotas: 6, listaId: LISTA_A, montoMinimo: null, marcas: null },
      { cuotas: 9, listaId: LISTA_A, montoMinimo: null, marcas: null },
    ]
    const deseadas = [
      { cuotas: 3, listaId: LISTA_A, montoMinimo: null, marcas: null },
      { cuotas: 6, listaId: LISTA_B, montoMinimo: null, marcas: null },
      { cuotas: 12, listaId: LISTA_B, montoMinimo: null, marcas: null },
    ]
    expect(cambiosDeCuotas("mercadopago", actuales, deseadas)).toEqual([
      { op: "setCondicion", medioSlug: "mercadopago", cuotas: 6, listaId: LISTA_B, montoMinimo: null, marcas: null },
      { op: "setCondicion", medioSlug: "mercadopago", cuotas: 12, listaId: LISTA_B, montoMinimo: null, marcas: null },
      { op: "setCondicion", medioSlug: "mercadopago", cuotas: 9, listaId: null },
    ])
    expect(cambiosDeCuotas("mercadopago", actuales, actuales)).toEqual([])
  })

  it("cambiosDeCuotas: cambiar solo el mínimo genera un cambio; quitarlo también", () => {
    const base = [{ cuotas: 6, listaId: LISTA_A, montoMinimo: "50000.00", marcas: null }]
    expect(cambiosDeCuotas("mercadopago", base, [{ cuotas: 6, listaId: LISTA_A, montoMinimo: "80000.00", marcas: null }])).toEqual([
      { op: "setCondicion", medioSlug: "mercadopago", cuotas: 6, listaId: LISTA_A, montoMinimo: "80000.00", marcas: null },
    ])
    expect(cambiosDeCuotas("mercadopago", base, [{ cuotas: 6, listaId: LISTA_A, montoMinimo: null, marcas: null }])).toEqual([
      { op: "setCondicion", medioSlug: "mercadopago", cuotas: 6, listaId: LISTA_A, montoMinimo: null, marcas: null },
    ])
  })

  it("validarFilasCuotas: tarjetas 'Todas' (null) o elegidas; 'Elegir' sin ninguna es un error en usted", () => {
    expect(
      validarFilasCuotas([
        { cuotas: "3", listaId: LISTA_A, marcas: null },
        { cuotas: "6", listaId: LISTA_A, marcas: ["mastercard", "visa"] },
      ]),
    ).toEqual({
      ok: true,
      filas: [
        { cuotas: 3, listaId: LISTA_A, montoMinimo: null, marcas: null },
        { cuotas: 6, listaId: LISTA_A, montoMinimo: null, marcas: ["visa", "mastercard"] },
      ],
    })
    expect(validarFilasCuotas([{ cuotas: "6", listaId: LISTA_A, marcas: [] }])).toEqual({
      ok: false,
      error: "Seleccione al menos una tarjeta o elija todas.",
    })
  })

  it("cambiosDeCuotas: cambiar solo las tarjetas genera un cambio, sin importar el orden; todo cambio lleva las marcas", () => {
    const base = [{ cuotas: 6, listaId: LISTA_A, montoMinimo: "50000.00", marcas: ["visa", "mastercard"] }]
    expect(cambiosDeCuotas("mercadopago", base, [{ ...base[0], marcas: ["mastercard", "visa"] }])).toEqual([])
    expect(cambiosDeCuotas("mercadopago", base, [{ ...base[0], marcas: ["visa"] }])).toEqual([
      { op: "setCondicion", medioSlug: "mercadopago", cuotas: 6, listaId: LISTA_A, montoMinimo: "50000.00", marcas: ["visa"] },
    ])
    expect(cambiosDeCuotas("mercadopago", base, [{ ...base[0], marcas: null }])).toEqual([
      { op: "setCondicion", medioSlug: "mercadopago", cuotas: 6, listaId: LISTA_A, montoMinimo: "50000.00", marcas: null },
    ])
    // Cambiar el mínimo no borra las tarjetas elegidas.
    expect(cambiosDeCuotas("mercadopago", base, [{ ...base[0], montoMinimo: null }])).toEqual([
      { op: "setCondicion", medioSlug: "mercadopago", cuotas: 6, listaId: LISTA_A, montoMinimo: null, marcas: ["visa", "mastercard"] },
    ])
  })
})

describe("cuerpoDeOpciones", () => {
  it("sin cambios no manda el campo (aunque el orden sea otro)", () => {
    expect(cuerpoDeOpciones(["debito", "credito"], ["credito", "debito"])).toEqual({})
  })

  it("con cambios manda la lista completa en orden canónico", () => {
    expect(cuerpoDeOpciones(["cuenta_mp", "credito"], ["credito", "debito", "cuenta_mp"])).toEqual({
      opcionesCobro: ["credito", "cuenta_mp"],
    })
    expect(cuerpoDeOpciones([], ["debito"])).toEqual({ opcionesCobro: [] })
  })
})
