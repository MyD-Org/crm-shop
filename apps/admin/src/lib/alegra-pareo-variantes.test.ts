import { describe, expect, it } from "vitest"
import type { AlegraProduct } from "./alegra"
import { mapItemSecundario, parearPadres, parearPorCodigo, type ItemPrincipalPareo, type ItemSecundarioPareo } from "./alegra-pareo"

// Variantes (change `variantes-de-producto`, S3): el padre y sus variantes comparten código, así
// que el pareo es por (código, opción). Datos de fantasía.

const P = (alegraId: string, code: string | null, activo = true): ItemPrincipalPareo => ({ alegraId, code, activo })
const PV = (alegraId: string, code: string | null, varianteClave: string | null, activo = true): ItemPrincipalPareo => ({
  alegraId,
  code,
  activo,
  tipo: "variante",
  varianteClave,
})
const SV = (alegraId: string, code: string | null, varianteClave: string | null): ItemSecundarioPareo => ({
  alegraId,
  code,
  tipo: "variante",
  varianteClave,
})
const padreP = (alegraId: string, code: string | null, activo = true): ItemPrincipalPareo => ({ alegraId, code, activo, tipo: "padre" })
const padreS = (alegraId: string, code: string | null): ItemSecundarioPareo => ({ alegraId, code, tipo: "padre" })

describe("parearPorCodigo con variantes", () => {
  it("variantes con el mismo código y distinta opción forman dos pares (no son duplicados)", () => {
    const r = parearPorCodigo(
      [PV("1", "P18", "blanco calido"), PV("2", "P18", "blanco frio")],
      [SV("m1", "p18", "blanco calido"), SV("m2", "p18", "blanco frio")],
    )
    expect(r.pares.map((p) => [p.principalAlegraId, p.secundarioAlegraId])).toEqual([
      ["1", "m1"],
      ["2", "m2"],
    ])
    expect(r.duplicados).toEqual([])
    expect(r.soloSecundaria).toEqual([])
  })

  it("el padre comparte código con sus variantes y no cuenta como duplicado ni como vendible", () => {
    const r = parearPorCodigo(
      [padreP("10", "P18"), PV("1", "P18", "rojo")],
      [padreS("m10", "P18"), SV("m1", "P18", "rojo"), SV("m2", "P18", "verde")],
    )
    expect(r.duplicados).toEqual([])
    expect(r.pares).toHaveLength(1)
    expect(r.soloSecundaria.map((s) => s.secundarioAlegraId)).toEqual(["m2"])
    expect(r.padres.pares).toEqual([{ principalAlegraId: "10", secundarioAlegraId: "m10" }])
  })

  it("una opción sin contraparte en la secundaria deja la variante solo-principal (no genera nada)", () => {
    const r = parearPorCodigo([PV("1", "P18", "calido"), PV("2", "P18", "frio")], [SV("m1", "P18", "calido")])
    expect(r.pares).toHaveLength(1)
    expect(r.soloSecundaria).toEqual([])
  })

  it("una opción solo en la secundaria entra como solo-secundaria", () => {
    const r = parearPorCodigo([PV("1", "P18", "calido")], [SV("m1", "P18", "calido"), SV("m2", "P18", "neutro")])
    expect(r.pares).toHaveLength(1)
    expect(r.soloSecundaria).toEqual([{ clave: "p18#neutro", secundarioAlegraId: "m2", principalInactivaAlegraId: null }])
  })

  it("una variante de la principal inactiva con la misma opción: la secundaria la adopta", () => {
    const r = parearPorCodigo([PV("1", "P18", "rojo", false)], [SV("m1", "P18", "rojo")])
    expect(r.pares).toEqual([])
    expect(r.soloSecundaria).toEqual([{ clave: "p18#rojo", secundarioAlegraId: "m1", principalInactivaAlegraId: "1" }])
  })

  it("duplicado real (mismo código y misma opción) va a revisar y no entra", () => {
    const r = parearPorCodigo([], [SV("m1", "P18", "rojo"), SV("m2", "P18", "rojo")])
    expect(r.duplicados).toEqual([{ clave: "p18#rojo", principal: [], secundaria: ["m1", "m2"] }])
    expect(r.soloSecundaria).toEqual([])
  })

  it("variante sin opción: no se parea y se informa; sin código tampoco duplica", () => {
    const r = parearPorCodigo([PV("1", "P18", "rojo")], [SV("m1", "P18", null), SV("m2", null, "rojo"), SV("m3", null, "rojo")])
    expect(r.sinOpcion).toEqual([{ lado: "secundaria", alegraId: "m1" }])
    expect(r.sinCodigo.map((x) => x.alegraId)).toEqual(["m2", "m3"])
    expect(r.duplicados).toEqual([])
    expect(r.pares).toEqual([])
    expect(r.soloSecundaria).toEqual([])
  })

  it("cruce simple/variante con el mismo código: a revisar, nunca par", () => {
    const r = parearPorCodigo([P("1", "P18")], [SV("m1", "P18", "rojo")])
    expect(r.pares).toEqual([])
    expect(r.soloSecundaria).toEqual([])
    expect(r.duplicados).toEqual([{ clave: "p18", principal: ["1"], secundaria: ["m1"] }])
  })

  it("las opciones se comparan normalizadas por quien arma la clave: claves iguales = par", () => {
    const r = parearPorCodigo([PV("1", "P18", "blanco calido")], [SV("m1", "P18", "blanco calido")])
    expect(r.pares).toHaveLength(1)
  })

  it("un modelo con 6 variantes y un código compartido no marca nada", () => {
    const ops = ["a", "b", "c", "d", "e", "f"]
    const r = parearPorCodigo(
      [padreP("10", "MOD"), ...ops.map((o, i) => PV(String(i + 1), "MOD", o))],
      [padreS("m10", "MOD"), ...ops.map((o, i) => SV(`m${i + 1}`, "MOD", o))],
    )
    expect(r.pares).toHaveLength(6)
    expect(r.duplicados).toEqual([])
    expect(r.sinCodigo).toEqual([])
    expect(r.sinOpcion).toEqual([])
  })

  it("un modelo solo-MDP queda como solo-secundaria por opción y su padre sin par", () => {
    const r = parearPorCodigo([], [padreS("m10", "LED"), SV("m1", "LED", "rojo"), SV("m2", "LED", "verde"), SV("m3", "LED", "azul")])
    expect(r.soloSecundaria.map((s) => s.secundarioAlegraId)).toEqual(["m1", "m2", "m3"])
    expect(r.padres).toEqual({ pares: [], sinPar: ["m10"] })
  })

  it("un padre de la principal sin código no se informa como 'sin código'", () => {
    const r = parearPorCodigo([padreP("10", null)], [])
    expect(r.sinCodigo).toEqual([])
  })
})

describe("parearPadres", () => {
  it("código único a ambos lados: par; el resto, sin par", () => {
    const r = parearPadres([padreP("1", "A"), padreP("2", "B"), padreP("3", "B")], [padreS("m1", "a"), padreS("m2", "B"), padreS("m3", null)])
    expect(r.pares).toEqual([{ principalAlegraId: "1", secundarioAlegraId: "m1" }])
    expect(r.sinPar).toEqual(["m2", "m3"])
  })

  it("un padre inactivo de la principal no se parea; padres repetidos en la secundaria tampoco", () => {
    expect(parearPadres([padreP("1", "A", false)], [padreS("m1", "A")]).sinPar).toEqual(["m1"])
    expect(parearPadres([padreP("1", "A")], [padreS("m1", "A"), padreS("m2", "A")]).pares).toEqual([])
  })
})

describe("mapItemSecundario con padre pareado", () => {
  const item = {
    alegraId: "5",
    code: "X",
    name: "X / Rojo",
    description: null,
    categoryAlegraId: null,
    prices: [],
    stock: 1,
    status: "active",
    images: [],
    brand: null,
    ivaPorcentaje: 21,
    raw: { id: "5", price: [] },
    tipo: "variante",
    padreAlegraId: "40",
  } as unknown as AlegraProduct

  it("el padre canónico de la principal reemplaza al sintético", () => {
    const m = mapItemSecundario(item, { id: "c1", slug: "mdp" }, [], [], [], new Map([["40", "900"]]))
    expect(m.producto.padreAlegraId).toBe("900")
  })

  it("sin padre pareado queda el sintético", () => {
    const m = mapItemSecundario(item, { id: "c1", slug: "mdp" }, [], [], [], new Map())
    expect(m.producto.padreAlegraId).toBe("mdp:40")
  })
})
