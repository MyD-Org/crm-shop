import { describe, expect, it } from "vitest"
import {
  datosEnvioDeCoresa,
  planearCargaCoresa,
  normalizarSku,
  numeroPositivo,
  parsearMedidas,
  skuCoresaDeCodigo,
  textosDatosEnvio,
} from "./catalogo-datos-envio"

describe("parsearMedidas", () => {
  it("lee 'a x b x c' en cm, en el orden en que viene", () => {
    expect(parsearMedidas("1.4 x 7.4 x 19.1")).toEqual({ altoCm: 1.4, anchoCm: 7.4, largoCm: 19.1 })
  })
  it("admite sufijo cm, coma decimal y convierte mm", () => {
    expect(parsearMedidas("10 x 20 x 30 cm")).toEqual({ altoCm: 10, anchoCm: 20, largoCm: 30 })
    expect(parsearMedidas("1,5 x 2 x 3")).toEqual({ altoCm: 1.5, anchoCm: 2, largoCm: 3 })
    expect(parsearMedidas("15 x 20 x 35 mm")).toEqual({ altoCm: 1.5, anchoCm: 2, largoCm: 3.5 })
  })
  it("sin dato, dos medidas o un cero → null", () => {
    expect(parsearMedidas("")).toBeNull()
    expect(parsearMedidas("10 x 20")).toBeNull()
    expect(parsearMedidas("0 x 20 x 30")).toBeNull()
    expect(parsearMedidas(12)).toBeNull()
  })
})

describe("numeroPositivo", () => {
  it("0, vacío y basura son sin dato", () => {
    expect(numeroPositivo(0)).toBeNull()
    expect(numeroPositivo("")).toBeNull()
    expect(numeroPositivo("abc")).toBeNull()
    expect(numeroPositivo(-1)).toBeNull()
    expect(numeroPositivo("0,25")).toBe(0.25)
    expect(numeroPositivo(1.12)).toBe(1.12)
  })
})

describe("datosEnvioDeCoresa", () => {
  it("arma los datos de una fila completa", () => {
    expect(
      datosEnvioDeCoresa({ "Medidas Venta (cm)": "9 x 11 x 11", "Peso Venta (kg)": 1.12, "Unidad Mínima": "1", "Caja Master": "60" }),
    ).toEqual({ pesoKg: 1.12, altoCm: 9, anchoCm: 11, largoCm: 11, unidadMinima: 1, unidadesPorCaja: 60, fuente: "coresa" })
  })
  it("peso 0 queda sin dato pero las medidas se guardan", () => {
    const d = datosEnvioDeCoresa({ "Medidas Venta (cm)": "3.2 x 6.1 x 15", "Peso Venta (kg)": 0, "Unidad Mínima": "1", "Caja Master": "50" })
    expect(d?.pesoKg).toBeNull()
    expect(d?.largoCm).toBe(15)
  })
  it("fila sin ningún dato → null", () => {
    expect(datosEnvioDeCoresa({ "Medidas Venta (cm)": "", "Peso Venta (kg)": 0, "Unidad Mínima": "", "Caja Master": "" })).toBeNull()
  })
  it("unidades no enteras se descartan", () => {
    expect(datosEnvioDeCoresa({ "Unidad Mínima": "1.5", "Caja Master": "20" })?.unidadMinima).toBeNull()
  })
})

describe("skuCoresaDeCodigo", () => {
  it("saca el sufijo de marca", () => {
    expect(skuCoresaDeCodigo("RMS-2M-NEG-MCL")).toBe("RMS-2M-NEG")
    expect(skuCoresaDeCodigo("NXB-63 1P C16-CHINT")).toBe("NXB-63 1P C16")
    expect(skuCoresaDeCodigo("TW SAK 4/10 BL-WDM")).toBe("TW SAK 4/10 BL")
    expect(skuCoresaDeCodigo("ipc-123-unv")).toBe("ipc-123")
  })
  it("sin sufijo de Coresa → null", () => {
    expect(skuCoresaDeCodigo("ADAPT-UNIV-SM")).toBeNull()
    expect(skuCoresaDeCodigo(null)).toBeNull()
    expect(skuCoresaDeCodigo("-MCL")).toBeNull()
  })
  it("normalizarSku es tolerante a mayúsculas y espacios", () => {
    expect(normalizarSku(" tw  sak 4/10 bl ")).toBe("TW SAK 4/10 BL")
  })
})

describe("textosDatosEnvio", () => {
  it("muestra 'Sin dato' donde falta", () => {
    const t = textosDatosEnvio({ pesoKg: null, altoCm: 9, anchoCm: 11, largoCm: 11.5, unidadMinima: 1, unidadesPorCaja: null, fuente: "coresa" })
    expect(t.map((x) => x.valor)).toEqual(["Sin dato", "9 × 11 × 11,5 cm", "1", "Sin dato", "Datos del proveedor (Coresa)"])
  })
})

describe("planearCargaCoresa", () => {
  const filas = [
    { SKU: "RMS-2M-NEG", "Medidas Venta (cm)": "3 x 4 x 5", "Peso Venta (kg)": 0.2, "Unidad Mínima": "1", "Caja Master": "50" },
    { SKU: "SIN-DATOS", "Medidas Venta (cm)": "", "Peso Venta (kg)": 0, "Unidad Mínima": "", "Caja Master": "" },
    { SKU: "DOBLE", "Peso Venta (kg)": 1 },
    { SKU: "doble", "Peso Venta (kg)": 2 },
    { SKU: "IGUAL", "Peso Venta (kg)": 1 },
    { SKU: "IGUAL", "Peso Venta (kg)": 1 },
  ]
  it("cruza por SKU sin sufijo y clasifica lo que no entra", () => {
    const plan = planearCargaCoresa(
      [
        { alegraId: "1", code: "RMS-2M-NEG-MCL" },
        { alegraId: "mdp:2", code: "rms-2m-neg-MCL" },
        { alegraId: "3", code: "SIN-DATOS-CHINT" },
        { alegraId: "4", code: "DOBLE-UNV" },
        { alegraId: "5", code: "NO-ESTA-DCK" },
        { alegraId: "6", code: "OTRA-MARCA" },
        { alegraId: "7", code: null },
        { alegraId: "8", code: "IGUAL-KNG" },
      ],
      filas,
    )
    expect(plan.cargar.map((c) => c.alegraId)).toEqual(["1", "mdp:2", "8"])
    expect(plan.cargar[0].datos).toMatchObject({ pesoKg: 0.2, altoCm: 3, unidadesPorCaja: 50 })
    expect(plan.sinDatos).toEqual(["SIN-DATOS-CHINT"])
    expect(plan.ambiguos).toEqual(["DOBLE-UNV"])
    expect(plan.sinMatch).toEqual(["NO-ESTA-DCK"])
  })
})
