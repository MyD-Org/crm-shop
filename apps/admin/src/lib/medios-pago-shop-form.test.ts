import { describe, it, expect } from "vitest"
import type { MedioPagoConAvisos } from "@/lib/medios-pago-shop-repo"
import { LISTA_POR_DEFECTO, aplicarMedioGuardado, cuerpoDePrecios } from "@/lib/medios-pago-shop-form"

const medio = (slug: string, extra: Partial<MedioPagoConAvisos> = {}): MedioPagoConAvisos => ({
  slug,
  nombre: slug,
  instrucciones: "",
  activo: true,
  aplicaRetiro: true,
  aplicaEnvio: true,
  cobroOnline: false,
  orden: 0,
  idListaPrecios: null,
  listaPreciosNombre: null,
  destacarEnCatalogo: false,
  mostrarEnFicha: false,
  avisos: [],
  ...extra,
})

describe("cuerpoDePrecios", () => {
  it("'Lista por defecto' viaja como null y conserva los flags", () => {
    expect(cuerpoDePrecios({ idListaPrecios: LISTA_POR_DEFECTO, destacarEnCatalogo: true, mostrarEnFicha: true })).toEqual({
      idListaPrecios: null,
      destacarEnCatalogo: true,
      mostrarEnFicha: true,
    })
  })
  it("una lista elegida viaja con su id", () => {
    expect(cuerpoDePrecios({ idListaPrecios: "3", destacarEnCatalogo: false, mostrarEnFicha: false })).toEqual({
      idListaPrecios: "3",
      destacarEnCatalogo: false,
      mostrarEnFicha: false,
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
