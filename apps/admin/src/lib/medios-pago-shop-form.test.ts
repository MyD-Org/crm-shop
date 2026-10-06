import { describe, it, expect } from "vitest"
import type { MedioPagoConAvisos } from "@/lib/medios-pago-shop-repo"
import { aplicarMedioGuardado, cuerpoDePrecios } from "@/lib/medios-pago-shop-form"

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
