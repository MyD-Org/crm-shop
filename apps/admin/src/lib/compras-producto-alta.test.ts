import { describe, expect, it, vi } from "vitest"
import type { AlegraItemCompraInput, AlegraPriceList, AlegraProduct, AlegraTax } from "./alegra"
import { ErrorCompras } from "./compras-dinero"
import {
  construirReferencia,
  crearProductoCompra,
  listasParaAlta,
  validarEntradaAlta,
  type DepsAlta,
  type EntradaAlta,
} from "./compras-producto-alta"
import { EMPTY_TENANT } from "./tenants"

const config = { ...EMPTY_TENANT, alegraMock: true }
const cuenta = { id: "c1", slug: "mdp", nombre: "Mar del Plata", principal: false }
const LISTAS: AlegraPriceList[] = [
  { alegraId: "31", name: "General", type: null, status: "active" },
  { alegraId: "32", name: "L1", type: null, status: "active" },
  { alegraId: "33", name: "L2", type: null, status: "active" },
  { alegraId: "34", name: "L5", type: null, status: "active" },
  { alegraId: "35", name: "PROMOCION EFECTIVO", type: null, status: "active" },
]
const TAXES = [{ alegraId: "9", name: "IVA 21%", percentage: 21, status: "active" }] as AlegraTax[]

const precios = (costo: number) =>
  [
    ["31", 1.6],
    ["32", 1.6],
    ["33", 1.4],
    ["34", 1.25],
    ["35", 1.3],
  ].map(([id, m]) => ({ id: String(id), precio: Math.round(costo * Number(m) * 100) / 100 }))

const entrada = (p: Partial<EntradaAlta> = {}): EntradaAlta => ({
  cuenta: "mdp",
  nombre: "Lámpara LED 9W",
  codigoProveedor: "LED9W",
  marca: "Macroled",
  sufijoMarca: "MCL",
  categoriaId: null,
  unidad: "unit",
  ivaPorcentaje: 21,
  costo: 100,
  precios: precios(100),
  confirmar: true,
  ...p,
})

function fakes(over: Partial<DepsAlta> = {}) {
  const creados: AlegraItemCompraInput[] = []
  const enAlegra: AlegraProduct[] = []
  const deps: DepsAlta = {
    listasDeCuenta: async () => LISTAS,
    impuestos: async () => TAXES,
    buscarPorCodigo: async (_c, codigo) => enAlegra.filter((i) => (i.code ?? "").toLowerCase() === codigo.toLowerCase()),
    crearItem: async (_c, input) => {
      await new Promise((r) => setTimeout(r, 5))
      creados.push(input)
      const it = { alegraId: `7${creados.length}`, code: input.reference, name: input.name, status: "active" } as AlegraProduct
      enAlegra.push(it)
      return it
    },
    catalogoPorCodigos: async () => [],
    // Lock real en memoria: serializa por clave.
    conLock: (() => {
      let cola: Promise<unknown> = Promise.resolve()
      return <T>(_k: string, fn: () => Promise<T>) => {
        const r = cola.then(fn)
        cola = r.catch(() => undefined)
        return r
      }
    })(),
    registrarEnEspejo: async (_t, c, _cfg, id) => ({ alegraId: `${c.slug}:${id}`, espejado: true }),
    guardarAjustes: vi.fn(async (_t, _c, _i, a) => a.length),
    ...over,
  }
  return { deps, creados, enAlegra }
}

const codigo = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e instanceof ErrorCompras ? e.codigo : `otro: ${String(e)}`
  }
  return null
}

describe("validarEntradaAlta", () => {
  it("arma la referencia con el sufijo en mayúsculas", () => {
    expect(construirReferencia("LED9W", "mcl")).toBe("LED9W-MCL")
    expect(validarEntradaAlta({ ...entrada(), sufijoMarca: "mcl" }).sufijoMarca).toBe("MCL")
  })

  it("exige sufijo, costo y precios", () => {
    expect(() => validarEntradaAlta({ ...entrada(), sufijoMarca: "" })).toThrow(/sufijo/)
    expect(() => validarEntradaAlta({ ...entrada(), costo: 0 })).toThrow(/costo/)
    expect(() => validarEntradaAlta({ ...entrada(), precios: undefined })).toThrow(/precio/)
  })
})

describe("crearProductoCompra", () => {
  it("sin confirmar no escribe nada en Alegra", async () => {
    const { deps, creados } = fakes()
    expect(await codigo(crearProductoCompra("t", cuenta, config, entrada({ confirmar: false }), deps))).toBe("confirmacion_requerida")
    expect(creados).toHaveLength(0)
  })

  it("crea con referencia, unidad, costo, todas las listas de la cuenta (ids de la cuenta) y sin ajustes si usa los %", async () => {
    const { deps, creados } = fakes()
    const r = await crearProductoCompra("t", cuenta, config, entrada(), deps)
    expect(creados).toHaveLength(1)
    expect(creados[0]).toMatchObject({ reference: "LED9W-MCL", unit: "unit", unitCost: 100, taxId: "9", brand: "Macroled" })
    expect(creados[0].prices).toEqual([
      { idPriceList: "31", price: 160 },
      { idPriceList: "32", price: 160 },
      { idPriceList: "33", price: 140 },
      { idPriceList: "34", price: 125 },
      { idPriceList: "35", price: 130 },
    ])
    expect(r).toMatchObject({ alegraId: "mdp:71", itemIdCuenta: "71", yaExistia: false, espejado: true, ajustes: [] })
    expect(deps.guardarAjustes).not.toHaveBeenCalled()
  })

  it("guarda sólo las listas cuyo % se editó", async () => {
    const { deps, creados } = fakes()
    const p = precios(100).map((x) => (x.id === "33" ? { ...x, precio: 150 } : x))
    const r = await crearProductoCompra("t", cuenta, config, entrada({ precios: p }), deps)
    expect(creados[0].prices.find((x) => x.idPriceList === "33")?.price).toBe(150)
    expect(r.ajustes).toEqual([{ listaId: "33", porcentaje: 50 }])
    expect(deps.guardarAjustes).toHaveBeenCalledWith("t", "c1", "71", [{ listaId: "33", porcentaje: 50 }])
  })

  it("doble clic simultáneo: crea un solo ítem", async () => {
    const { deps, creados } = fakes()
    const [a, b] = await Promise.all([
      crearProductoCompra("t", cuenta, config, entrada(), deps),
      crearProductoCompra("t", cuenta, config, entrada(), deps),
    ])
    expect(creados).toHaveLength(1)
    expect([a.yaExistia, b.yaExistia].sort()).toEqual([false, true])
    expect(a.itemIdCuenta).toBe(b.itemIdCuenta)
  })

  it("si ya existe en el catálogo, pide usar «Copiar»", async () => {
    const { deps, creados } = fakes({ catalogoPorCodigos: async () => [{ alegraId: "5", code: "LED9W-MCL", name: "Lámpara LED 9W" }] })
    expect(await codigo(crearProductoCompra("t", cuenta, config, entrada(), deps))).toBe("producto_existente")
    expect(creados).toHaveLength(0)
  })

  it("un ítem inactivo con esa referencia no se pisa", async () => {
    const { deps, enAlegra, creados } = fakes()
    enAlegra.push({ alegraId: "50", code: "LED9W-MCL", name: "x", status: "inactive" } as AlegraProduct)
    expect(await codigo(crearProductoCompra("t", cuenta, config, entrada(), deps))).toBe("item_inactivo")
    expect(creados).toHaveLength(0)
  })

  it("bloquea si una lista de la cuenta no tiene coeficiente", async () => {
    const { deps, creados } = fakes({ listasDeCuenta: async () => [...LISTAS, { alegraId: "99", name: "Mayorista VIP", type: null, status: "active" }] })
    expect(await codigo(crearProductoCompra("t", cuenta, config, entrada({ precios: [...precios(100), { id: "99", precio: 120 }] }), deps))).toBe("listas_sin_coeficiente")
    expect(creados).toHaveLength(0)
  })

  it("rechaza precios que no cubren todas las listas", async () => {
    const { deps } = fakes()
    expect(await codigo(crearProductoCompra("t", cuenta, config, entrada({ precios: precios(100).slice(1) }), deps))).toBe("listas_sin_coeficiente")
  })
})

describe("listasParaAlta", () => {
  it("devuelve cada lista con % por defecto y precio", async () => {
    const r = await listasParaAlta(config, cuenta, 200, { listasDeCuenta: async () => LISTAS })
    expect(r.map((l) => [l.nombre, l.porcentaje, l.precio])).toEqual([
      ["General", 60, 320],
      ["L1", 60, 320],
      ["L2", 40, 280],
      ["L5", 25, 250],
      ["PROMOCION EFECTIVO", 30, 260],
    ])
  })
})
