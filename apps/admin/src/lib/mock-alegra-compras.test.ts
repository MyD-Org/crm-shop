import { beforeEach, describe, expect, it } from "vitest"
import {
  borrarBill,
  buscarBills,
  clasificarErrorEscritura,
  crearBill,
  leerBill,
  reemplazarLineasBill,
  type BillCrearInput,
  type BillLineaEscritura,
} from "./alegra-compras"
import { __mockBillsAgregarPago, __mockBillsFallar, __mockBillsReset, calcularTotalBillCentavos } from "./mock-alegra-compras"
import type { TenantConfig } from "./tenants"

const config = { alegraEmail: "", alegraToken: "", alegraMock: true } as TenantConfig
const cat = (precioCentavos: number, cantidadMilesimas = 1000, taxIds = ["1"]): BillLineaEscritura => ({
  tipo: "cat", id: "5246", precioCentavos, cantidadMilesimas, taxIds,
})
const item = (precioCentavos: number, cantidadMilesimas: number): BillLineaEscritura => ({
  tipo: "item", id: "7001", precioCentavos, cantidadMilesimas, taxIds: ["1"],
})
const input = (lineas: BillLineaEscritura[], numero = "PRUEBA-API-00001"): BillCrearInput => ({
  proveedorId: "900", numero, fecha: "2026-11-15", vencimiento: "2026-12-15", almacenId: "wh-mock-1", observaciones: "", lineas,
})

beforeEach(() => __mockBillsReset())

describe("calcularTotalBillCentavos (modelo verificado contra Alegra real)", () => {
  it("3 líneas de 10,01 al 21 %: total 36,34 (no 36,33, que daría redondear por línea)", () => {
    expect(calcularTotalBillCentavos([cat(1001), cat(1001), cat(1001)])).toBe(3634)
  })
  it("mixto 21 % y 10,5 % con centavos impares: 49,32", () => {
    const total = calcularTotalBillCentavos([cat(1001), cat(1003), cat(1007, 1000, ["3"]), cat(1009, 1000, ["3"]), cat(33, 7000)])
    expect(total).toBe(4932)
  })
  it("subtotal fraccionario 0,33 x 1,5 al 21 %: 0,59895 redondea a 0,60", () => {
    expect(calcularTotalBillCentavos([cat(33, 1500)])).toBe(60)
  })
  it("exento y sin impuesto", () => {
    expect(calcularTotalBillCentavos([cat(10000, 1000, ["4"]), cat(500, 1000, [])])).toBe(10500)
  })
  it("cantidad grande: 100 x 1000,123 al 21 % (100012,30 + 21002,583 = 121014,883)", () => {
    expect(calcularTotalBillCentavos([cat(10000, 1_000_123)])).toBe(12101488)
  })
})

describe("mock de bills", () => {
  it("alta, lectura, PUT que reemplaza el bloque y DELETE", async () => {
    const creada = await crearBill(config, input([cat(100000)]))
    expect(creada.totalCentavos).toBe(121000)
    const l1 = await leerBill(config, creada.id)
    expect(l1?.lineas).toHaveLength(1)
    const put = await reemplazarLineasBill(config, creada.id, [item(10000, 4000), cat(60000)])
    expect(put.totalCentavos).toBe(121000)
    expect(put.lineas.map((l) => l.tipo).sort()).toEqual(["cat", "item"])
    const total = await reemplazarLineasBill(config, creada.id, [item(10000, 10_000)])
    expect(total.totalCentavos).toBe(121000)
    expect(total.lineas).toHaveLength(1)
    await expect(borrarBill(config, creada.id)).resolves.toBe("borrada")
    await expect(leerBill(config, creada.id)).resolves.toBeNull()
    await expect(borrarBill(config, creada.id)).resolves.toBe("no_existe")
  })

  it("buscarBills encuentra por proveedor y número", async () => {
    const b = await crearBill(config, input([cat(100)], "N-1"))
    await expect(buscarBills(config, { proveedorId: "900", numero: "N-1" })).resolves.toHaveLength(1)
    await expect(buscarBills(config, { proveedorId: "901", numero: "N-1" })).resolves.toEqual([])
    expect(b.numero).toBe("N-1")
  })

  it("rechaza número duplicado del mismo proveedor como Alegra (4xx)", async () => {
    await crearBill(config, input([cat(100)], "DUP"))
    const e = await crearBill(config, input([cat(100)], "DUP")).catch((x) => x)
    expect(clasificarErrorEscritura(e)).toBe("rechazada")
  })

  it("DELETE con pagos falla (400) y deja la bill", async () => {
    const b = await crearBill(config, input([cat(10000)]))
    __mockBillsAgregarPago(b.id, 1000)
    const e = await borrarBill(config, b.id).catch((x) => x)
    expect(clasificarErrorEscritura(e)).toBe("rechazada")
    expect((await leerBill(config, b.id))?.pagos).toHaveLength(1)
  })
})

describe("inyección de fallos", () => {
  it("5xx tras PUT: el PUT SE APLICÓ y el error es incierto", async () => {
    const b = await crearBill(config, input([cat(100000)]))
    __mockBillsFallar({ tras: "put", modo: "5xx" })
    const e = await reemplazarLineasBill(config, b.id, [item(10000, 10_000)]).catch((x) => x)
    expect(clasificarErrorEscritura(e)).toBe("incierta")
    expect((await leerBill(config, b.id))?.lineas[0].tipo).toBe("item")
  })

  it("corte tras POST: la bill existe aunque no hubo respuesta", async () => {
    __mockBillsFallar({ tras: "post", modo: "corte" })
    const e = await crearBill(config, input([cat(100)], "CORTE")).catch((x) => x)
    expect(clasificarErrorEscritura(e)).toBe("incierta")
    await expect(buscarBills(config, { proveedorId: "900", numero: "CORTE" })).resolves.toHaveLength(1)
  })

  it("429 NO aplica la operación", async () => {
    const b = await crearBill(config, input([cat(100000)]))
    __mockBillsFallar({ tras: "put", modo: "429" })
    const e = await reemplazarLineasBill(config, b.id, [item(10000, 10_000)]).catch((x) => x)
    expect(clasificarErrorEscritura(e)).toBe("no_aplicada")
    expect((await leerBill(config, b.id))?.lineas[0].tipo).toBe("cat")
  })

  it("corte tras DELETE: la bill ya no existe", async () => {
    const b = await crearBill(config, input([cat(100)]))
    __mockBillsFallar({ tras: "delete", modo: "corte" })
    await borrarBill(config, b.id).catch(() => undefined)
    await expect(leerBill(config, b.id)).resolves.toBeNull()
  })

  it("el fallo es de una sola vez", async () => {
    __mockBillsFallar({ tras: "post", modo: "429" })
    await crearBill(config, input([cat(100)], "A")).catch(() => undefined)
    await expect(crearBill(config, input([cat(100)], "A"))).resolves.toMatchObject({ numero: "A" })
  })
})
