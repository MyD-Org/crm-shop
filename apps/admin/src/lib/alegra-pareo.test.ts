import { describe, expect, it } from "vitest"
import type { AlegraProduct } from "./alegra"
import {
  alegraIdSintetico,
  estadoSoloSecundaria,
  mapItemSecundario,
  normalizarCodigo,
  parearPorCodigo,
  type ItemPrincipalPareo,
  type ItemSecundarioPareo,
} from "./alegra-pareo"

const P = (alegraId: string, code: string | null, activo = true): ItemPrincipalPareo => ({ alegraId, code, activo })
const S = (alegraId: string, code: string | null): ItemSecundarioPareo => ({ alegraId, code })

describe("normalizarCodigo", () => {
  it("trim + minúsculas + sin tildes + espacios colapsados", () => {
    expect(normalizarCodigo("  LED-Ñandú  9W ")).toBe("led-nandu 9w")
    expect(normalizarCodigo("Lámpara")).toBe("lampara")
  })
  it("vacío, espacios o null = sin código", () => {
    expect(normalizarCodigo(null)).toBe("")
    expect(normalizarCodigo(undefined)).toBe("")
    expect(normalizarCodigo("   ")).toBe("")
  })
})

describe("parearPorCodigo", () => {
  it("par simple: código único a ambos lados con la principal activa", () => {
    const r = parearPorCodigo([P("1", "AAA")], [S("m1", "aaa ")])
    expect(r.pares).toEqual([{ clave: "aaa", principalAlegraId: "1", secundarioAlegraId: "m1" }])
    expect(r.soloSecundaria).toEqual([])
    expect(r.duplicados).toEqual([])
    expect(r.sinCodigo).toEqual([])
  })

  it("solo-IGZ: un ítem que la secundaria no tiene no genera nada (el stock 0 lo pone la sync)", () => {
    const r = parearPorCodigo([P("1", "AAA")], [])
    expect(r.pares).toEqual([])
    expect(r.soloSecundaria).toEqual([])
  })

  it("solo-MDP: código sin fila en la principal", () => {
    const r = parearPorCodigo([P("1", "AAA")], [S("m9", "ZZZ")])
    expect(r.soloSecundaria).toEqual([{ clave: "zzz", secundarioAlegraId: "m9", principalInactivaAlegraId: null }])
    expect(r.pares).toEqual([])
  })

  it("IGZ inactiva + MDP con item: NO es par, entra como solo-secundaria adoptada (O8)", () => {
    const r = parearPorCodigo([P("1", "AAA", false)], [S("m1", "AAA")])
    expect(r.pares).toEqual([])
    expect(r.soloSecundaria).toEqual([{ clave: "aaa", secundarioAlegraId: "m1", principalInactivaAlegraId: "1" }])
  })

  it("IGZ activa con el mismo código que otra inactiva: manda la activa", () => {
    const r = parearPorCodigo([P("1", "AAA", false), P("2", "AAA", true)], [S("m1", "AAA")])
    expect(r.pares).toEqual([{ clave: "aaa", principalAlegraId: "2", secundarioAlegraId: "m1" }])
  })

  it("código duplicado en la secundaria: no entra, se informa", () => {
    const r = parearPorCodigo([P("1", "AAA")], [S("m1", "AAA"), S("m2", "aaa")])
    expect(r.pares).toEqual([])
    expect(r.soloSecundaria).toEqual([])
    expect(r.duplicados).toEqual([{ clave: "aaa", principal: [], secundaria: ["m1", "m2"] }])
  })

  it("código duplicado en la principal (dos activas): no entra, se informa", () => {
    const r = parearPorCodigo([P("1", "AAA"), P("2", "AAA")], [S("m1", "AAA")])
    expect(r.pares).toEqual([])
    expect(r.duplicados).toEqual([{ clave: "aaa", principal: ["1", "2"], secundaria: ["m1"] }])
  })

  it("sin código en la secundaria: no entra, se informa; un ítem principal activo sin código también", () => {
    const r = parearPorCodigo([P("1", null), P("2", "  ", false)], [S("m1", null), S("m2", "")])
    expect(r.pares).toEqual([])
    expect(r.soloSecundaria).toEqual([])
    expect(r.sinCodigo).toEqual([
      { lado: "principal", alegraId: "1" },
      { lado: "secundaria", alegraId: "m1" },
      { lado: "secundaria", alegraId: "m2" },
    ])
  })
})

describe("estadoSoloSecundaria", () => {
  it("no adoptada: siempre activa (visibilidad por overlay)", () => {
    expect(estadoSoloSecundaria(false, 0)).toBe("active")
    expect(estadoSoloSecundaria(false, null)).toBe("active")
  })
  it("adoptada: activa solo con stock de la secundaria > 0", () => {
    expect(estadoSoloSecundaria(true, 3)).toBe("active")
    expect(estadoSoloSecundaria(true, 0)).toBe("inactive")
    expect(estadoSoloSecundaria(true, null)).toBe("inactive")
  })
})

describe("mapItemSecundario", () => {
  const cuenta = { id: "c1", slug: "mdp" }
  const listasPrincipal = [
    { idPriceList: "1", name: "General" },
    { idPriceList: "5", name: "Mayorista" },
  ]
  const catsSec = [
    { alegraId: "77", name: "Iluminación" },
    { alegraId: "78", name: "Rara" },
  ]
  const catsPrincipal = [{ alegraId: "10", name: "ILUMINACION" }]

  const base = (over: Partial<AlegraProduct> = {}): AlegraProduct => ({
    alegraId: "1",
    code: "AAA",
    name: "Producto",
    description: null,
    categoryAlegraId: "77",
    prices: [
      { idPriceList: "9", name: "general", price: 100 },
      { idPriceList: "8", name: "Lista Especial", price: 50 },
    ],
    stock: 4,
    status: "active",
    images: [],
    brand: null,
    ivaPorcentaje: 21,
    raw: { id: 1, price: [{ idPriceList: 9, name: "general", price: 100 }, { idPriceList: 8, name: "Lista Especial", price: 50 }] },
    ...over,
  })

  it("id sintético único aunque el id numérico coincida con uno de la principal", () => {
    const m = mapItemSecundario(base(), cuenta, listasPrincipal, catsSec, catsPrincipal)
    expect(m.producto.alegraId).toBe("mdp:1")
    expect(m.producto.alegraId).toBe(alegraIdSintetico("mdp", "1"))
    expect(m.alegraIdCuenta).toBe("1")
  })

  it("listas por nombre normalizado; la lista sin equivalente se descarta y se informa", () => {
    const m = mapItemSecundario(base(), cuenta, listasPrincipal, catsSec, catsPrincipal)
    expect(m.producto.prices).toEqual([{ idPriceList: "1", name: "General", price: 100 }])
    expect(m.listasSinEquivalente).toEqual(["Lista Especial"])
    expect(m.producto.raw.price).toEqual([{ idPriceList: 1, name: "General", price: 100 }])
  })

  it("categoría por nombre contra la principal; sin match queda null", () => {
    expect(mapItemSecundario(base(), cuenta, listasPrincipal, catsSec, catsPrincipal).producto.categoryAlegraId).toBe("10")
    const sin = mapItemSecundario(base({ categoryAlegraId: "78" }), cuenta, listasPrincipal, catsSec, catsPrincipal)
    expect(sin.producto.categoryAlegraId).toBeNull()
    expect(sin.categoriaSinEquivalente).toBe(true)
  })

  it("ítem sin ninguna lista equivalente queda sin precios (no vendible)", () => {
    const m = mapItemSecundario(base({ prices: [{ idPriceList: "8", name: "Otra", price: 5 }] }), cuenta, listasPrincipal, catsSec, catsPrincipal)
    expect(m.producto.prices).toEqual([])
  })
})
