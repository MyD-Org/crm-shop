import { describe, expect, it } from "vitest"
import type { ProductoDto, VarianteDto } from "./tipos"
import {
  AVISO_MODELOS,
  candidatosDeModelo,
  candidatosParaSumar,
  cantidadInactivas,
  esModelo,
  esSuelto,
  etiquetaSugerida,
  necesitaEtiquetaBase,
  nombreDeVariante,
  resumenPrecio,
  stockTotal,
  textoCantidadVariantes,
  textoQuitar,
} from "./variantes-ui"

const variante = (o: Partial<VarianteDto> = {}): VarianteDto => ({
  alegraId: "v",
  code: null,
  nombreAlegra: "Cinta LED / Verde",
  etiqueta: "Verde",
  tipo: "variante",
  status: "active",
  alegraStatus: "active",
  prices: [{ price: 100 }],
  stock: "5",
  fotos: [],
  manual: false,
  orden: null,
  esRepresentante: false,
  esAncla: false,
  stockSucursales: [],
  ...o,
})

const producto = (o: Partial<ProductoDto> = {}): ProductoDto =>
  ({
    alegraId: "p",
    nombreAlegra: "Producto",
    nombreEfectivo: "Producto",
    sku: "P",
    tipo: "simple",
    grupoId: null,
    etiqueta: null,
    esAncla: false,
    variantes: [],
    prices: [],
    ...o,
  }) as unknown as ProductoDto

describe("textoCantidadVariantes", () => {
  it("singular y plural", () => {
    expect(textoCantidadVariantes(1)).toBe("1 variante")
    expect(textoCantidadVariantes(3)).toBe("3 variantes")
  })
})

describe("esModelo y esSuelto", () => {
  it("un modelo es un ancla con variantes", () => {
    expect(esModelo(producto({ esAncla: true, tipo: "padre", variantes: [variante()] }))).toBe(true)
    expect(esModelo(producto({ esAncla: true, tipo: "padre", variantes: [] }))).toBe(false)
    expect(esModelo(producto())).toBe(false)
  })

  it("suelto: simple, sin grupo y no ancla", () => {
    expect(esSuelto(producto())).toBe(true)
    expect(esSuelto(producto({ tipo: "padre", esAncla: true }))).toBe(false)
    expect(esSuelto(producto({ grupoId: "A", esAncla: true }))).toBe(false)
    expect(esSuelto(producto({ tipo: "variante", grupoId: "P" }))).toBe(false)
  })
})

describe("resumenPrecio: el precio del modelo", () => {
  it("toma el más bajo entre las variantes activas y avisa si difieren (Desde)", () => {
    const r = resumenPrecio([variante({ prices: [{ price: 120 }] }), variante({ prices: [{ price: 100 }] }), variante({ prices: [{ price: 180 }] })])
    expect(r).toEqual({ minimo: 100, difieren: true })
  })

  it("con todos los precios iguales no difieren", () => {
    expect(resumenPrecio([variante(), variante()])).toEqual({ minimo: 100, difieren: false })
  })

  it("ignora las de baja y las sin precio", () => {
    const r = resumenPrecio([
      variante({ prices: [{ price: 10 }], alegraStatus: "inactive" }),
      variante({ prices: [] }),
      variante({ prices: [{ price: "250" }] }),
    ])
    expect(r).toEqual({ minimo: 250, difieren: false })
    expect(resumenPrecio([variante({ prices: [] })])).toEqual({ minimo: null, difieren: false })
  })
})

describe("stockTotal", () => {
  it("suma las activas con dato; null si ninguna tiene", () => {
    expect(stockTotal([variante({ stock: "3" }), variante({ stock: "4.5" }), variante({ stock: null })])).toBe(7.5)
    expect(stockTotal([variante({ stock: null })])).toBeNull()
    expect(stockTotal([variante({ stock: "9", status: "inactive" })])).toBeNull()
  })
})

describe("cantidadInactivas", () => {
  it("cuenta las dadas de baja por cualquiera de los dos estados", () => {
    expect(cantidadInactivas([variante(), variante({ alegraStatus: "inactive" }), variante({ status: "inactive" })])).toBe(2)
  })
})

describe("candidatos del diálogo de sumar", () => {
  const suelto = producto({ alegraId: "s1" })
  const otroSuelto = producto({ alegraId: "s2" })
  const padre = producto({ alegraId: "P", tipo: "padre", esAncla: true })
  const base = producto({ alegraId: "A", esAncla: true, grupoId: "A" })
  const hija = producto({ alegraId: "v1", tipo: "variante", grupoId: "P" })

  it("para sumar: sólo productos sueltos, sin el modelo de destino", () => {
    expect(candidatosParaSumar([suelto, otroSuelto, padre, base, hija], "s2").map((p) => p.alegraId)).toEqual(["s1"])
  })

  it("para elegir el modelo: padres, bases y sueltos; nunca variantes ni el propio producto", () => {
    expect(candidatosDeModelo([suelto, otroSuelto, padre, base, hija], "s1").map((p) => p.alegraId)).toEqual(["s2", "P", "A"])
  })

  it("sólo un producto suelto elegido como modelo pide la etiqueta de su opción", () => {
    expect(necesitaEtiquetaBase(otroSuelto)).toBe(true)
    expect(necesitaEtiquetaBase(padre)).toBe(false)
    expect(necesitaEtiquetaBase(base)).toBe(false)
  })
})

describe("textos", () => {
  it("la etiqueta sugerida sale del último tramo del nombre", () => {
    expect(etiquetaSugerida("Cinta LED / RGB")).toBe("RGB")
    expect(etiquetaSugerida("Cinta LED RGB")).toBe("")
    expect(etiquetaSugerida("A / " + "x".repeat(80))).toHaveLength(60)
  })

  it("el nombre de una variante cae a su nombre de Alegra o a su código", () => {
    expect(nombreDeVariante(variante())).toBe("Verde")
    expect(nombreDeVariante(variante({ etiqueta: "  " }))).toBe("Cinta LED / Verde")
    expect(nombreDeVariante(variante({ etiqueta: null, nombreAlegra: "", code: "C1" }))).toBe("C1")
  })

  it("los textos van en español formal de usted", () => {
    expect(AVISO_MODELOS).toBe("Los cambios al modelo se verán en la tienda cuando se active el selector de variantes.")
    expect(textoQuitar("RGB")).toMatch(/^Va a quitar «RGB» del modelo\./)
    for (const t of [AVISO_MODELOS, textoQuitar("x")]) expect(t).not.toMatch(/\b(tu|tus|vos|podés|querés)\b/i)
  })
})
