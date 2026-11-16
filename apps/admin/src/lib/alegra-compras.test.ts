import { afterEach, describe, expect, it, vi } from "vitest"
import creada from "./__fixtures__/alegra-bill-creada.json"
import conItems from "./__fixtures__/alegra-bill-con-items.json"
import conPercepcion from "./__fixtures__/alegra-bill-con-percepcion.json"
import conPago from "./__fixtures__/alegra-bill-con-pago.json"
import {
  borrarBill,
  buscarBills,
  clasificarErrorEscritura,
  crearBill,
  leerBill,
  listarAlmacenes,
  listarCategoriasContables,
  parsearBill,
  reemplazarLineasBill,
  reemplazarPercepcionesBill,
  resolverCategoriaTransito,
  type CategoriaContable,
} from "./alegra-compras"
import { AlegraHttpError, AlegraRateLimitError } from "./alegra"
import type { TenantConfig } from "./tenants"

const TOKEN = "token-secreto-ejemplo"
const config = { alegraEmail: "cuenta@cuenta.example", alegraToken: TOKEN, alegraMock: false } as TenantConfig

type Llamada = { url: string; init: RequestInit }
function stubFetch(...respuestas: Array<{ status: number; body?: unknown } | Error>) {
  const llamadas: Llamada[] = []
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    llamadas.push({ url, init })
    const r = respuestas.shift() ?? { status: 200, body: {} }
    if (r instanceof Error) throw r
    return new Response(r.status === 204 ? null : JSON.stringify(r.body ?? {}), { status: r.status })
  })
  vi.stubGlobal("fetch", fn)
  return llamadas
}
const cuerpo = (l: Llamada) => JSON.parse(String(l.init.body))

afterEach(() => vi.unstubAllGlobals())

describe("crearBill", () => {
  it("hace POST /bills con categorías, precio en pesos, tax por id, número y depósito", async () => {
    const llamadas = stubFetch({ status: 201, body: creada })
    const bill = await crearBill(config, {
      proveedorId: "900",
      numero: "PRUEBA-API-00001",
      fecha: "2026-11-15",
      vencimiento: "2026-12-15",
      almacenId: "wh-ejemplo-1",
      observaciones: "[CRM compra:ab12cd34]",
      lineas: [{ tipo: "cat", id: "5246", precioCentavos: 100000, cantidadMilesimas: 1000, taxIds: ["1"] }],
    })
    expect(llamadas).toHaveLength(1)
    expect(llamadas[0].url).toMatch(/\/bills$/)
    expect(llamadas[0].init.method).toBe("POST")
    expect(cuerpo(llamadas[0])).toEqual({
      date: "2026-11-15",
      dueDate: "2026-12-15",
      provider: 900,
      numberTemplate: { number: "PRUEBA-API-00001" },
      warehouse: { id: "wh-ejemplo-1" },
      observations: "[CRM compra:ab12cd34]",
      purchases: { categories: [{ id: 5246, price: 1000, quantity: 1, tax: [{ id: 1 }] }] },
    })
    expect(bill.id).toBe("9001")
    expect(bill.totalCentavos).toBe(121000)
  })

  it("separa ítems y categorías en purchases y omite el tax cuando no hay", async () => {
    const llamadas = stubFetch({ status: 201, body: conItems })
    await crearBill(config, {
      proveedorId: "900",
      numero: "X",
      fecha: "2026-11-15",
      vencimiento: "2026-11-15",
      almacenId: "w",
      observaciones: "",
      lineas: [
        { tipo: "item", id: "7001", precioCentavos: 10000, cantidadMilesimas: 4000, taxIds: ["1"] },
        { tipo: "cat", id: "5233", precioCentavos: 500, cantidadMilesimas: 1000, taxIds: [] },
      ],
    })
    expect(cuerpo(llamadas[0]).purchases).toEqual({
      items: [{ id: 7001, price: 100, quantity: 4, tax: [{ id: 1 }] }],
      categories: [{ id: 5233, price: 5, quantity: 1 }],
    })
  })

  it("las escrituras llevan un timeout propio", async () => {
    const llamadas = stubFetch({ status: 201, body: creada })
    await crearBill(config, {
      proveedorId: "900", numero: "X", fecha: "2026-11-15", vencimiento: "2026-11-15", almacenId: "w", observaciones: "",
      lineas: [{ tipo: "cat", id: "5246", precioCentavos: 100, cantidadMilesimas: 1000, taxIds: ["1"] }],
    })
    expect(llamadas[0].init.signal).toBeDefined()
  })
})

describe("reemplazarPercepcionesBill", () => {
  it("PUT /bills/{id}/perceptions con un ARRAY [{id: idPerception, amount en pesos, certificateNumber}]", async () => {
    const llamadas = stubFetch({ status: 200, body: [] })
    await reemplazarPercepcionesBill(config, "9002", [
      { idPerception: "01a0eef5-e2d9-72c0-bc9c-bd3fc4780117", importeCentavos: 3050, certificado: "C-9" },
      { idPerception: "uuid-2", importeCentavos: 100 },
    ])
    expect(llamadas[0].init.method).toBe("PUT")
    expect(llamadas[0].url).toMatch(/\/bills\/9002\/perceptions$/)
    expect(cuerpo(llamadas[0])).toEqual([
      { id: "01a0eef5-e2d9-72c0-bc9c-bd3fc4780117", amount: 30.5, certificateNumber: "C-9" },
      { id: "uuid-2", amount: 1 },
    ])
  })

  it("una lista vacía limpia las percepciones", async () => {
    const llamadas = stubFetch({ status: 200, body: [] })
    await reemplazarPercepcionesBill(config, "9002", [])
    expect(cuerpo(llamadas[0])).toEqual([])
  })

  it("un 4xx se clasifica como rechazada", async () => {
    stubFetch({ status: 400, body: { message: "inválida", code: 11414 } })
    const e = await reemplazarPercepcionesBill(config, "9002", [{ idPerception: "x", importeCentavos: 1 }]).catch((x) => x)
    expect(clasificarErrorEscritura(e)).toBe("rechazada")
  })
})

describe("reemplazarLineasBill", () => {
  it("el PUT contiene SÓLO purchases (no número, proveedor, fecha ni depósito)", async () => {
    const llamadas = stubFetch({ status: 200, body: conItems })
    await reemplazarLineasBill(config, "9002", [
      { tipo: "item", id: "7001", precioCentavos: 10000, cantidadMilesimas: 4000, taxIds: ["1"] },
      { tipo: "cat", id: "5246", precioCentavos: 60000, cantidadMilesimas: 1000, taxIds: ["1"] },
    ])
    expect(llamadas[0].init.method).toBe("PUT")
    expect(llamadas[0].url).toMatch(/\/bills\/9002$/)
    const body = cuerpo(llamadas[0])
    expect(Object.keys(body)).toEqual(["purchases"])
    expect(body.purchases.items).toEqual([{ id: 7001, price: 100, quantity: 4, tax: [{ id: 1 }] }])
    expect(body.purchases.categories).toEqual([{ id: 5246, price: 600, quantity: 1, tax: [{ id: 1 }] }])
  })

  it("sin categorías no manda la clave categories (omitirla quita el tránsito)", async () => {
    const llamadas = stubFetch({ status: 200, body: conPago })
    await reemplazarLineasBill(config, "9004", [
      { tipo: "item", id: "7001", precioCentavos: 10000, cantidadMilesimas: 1000, taxIds: ["1"] },
    ])
    expect(cuerpo(llamadas[0]).purchases).toEqual({ items: [{ id: 7001, price: 100, quantity: 1, tax: [{ id: 1 }] }] })
  })
})

describe("leerBill / parsearBill", () => {
  it("404 devuelve null", async () => {
    stubFetch({ status: 404, body: { message: "no existe" } })
    await expect(leerBill(config, "1")).resolves.toBeNull()
  })

  it("parsea total, saldo, líneas de tránsito y proveedor", () => {
    const b = parsearBill(creada)
    expect(b).toMatchObject({
      id: "9001",
      estado: "open",
      numero: "PRUEBA-API-00001",
      proveedorId: "900",
      almacenId: "wh-ejemplo-1",
      totalCentavos: 121000,
      pagadoCentavos: 0,
      saldoCentavos: 121000,
      pagos: [],
      retenciones: [],
    })
    expect(b.lineas).toEqual([
      { tipo: "cat", id: "5246", nombre: "Mercadería en tránsito", precioCentavos: 100000, cantidadMilesimas: 1000, taxIds: ["1"] },
    ])
  })

  it("parsea ítems y categorías juntas, con cantidades fraccionarias en milésimas", () => {
    const b = parsearBill(conItems)
    expect(b.lineas.map((l) => [l.tipo, l.id, l.precioCentavos, l.cantidadMilesimas])).toEqual([
      ["item", "7001", 10000, 4000],
      ["cat", "5246", 60000, 1000],
    ])
    const frac = parsearBill({
      ...creada,
      purchases: { categories: [{ id: "5246", price: 0.33, quantity: 1.5, tax: [{ id: "1" }] }] },
    })
    expect(frac.lineas[0]).toMatchObject({ precioCentavos: 33, cantidadMilesimas: 1500 })
  })

  it("una línea sin impuesto (percepción representada como cuenta de gasto) queda sin taxIds", () => {
    const b = parsearBill(conPercepcion)
    expect(b.totalCentavos).toBe(12600)
    expect(b.lineas[1]).toMatchObject({ tipo: "cat", id: "5233", precioCentavos: 500, taxIds: [] })
  })

  it("parsea pagos y saldo", () => {
    const b = parsearBill(conPago)
    expect(b.pagos).toEqual([{ id: "8001", numero: "00001-41", montoCentavos: 1190000 }])
    expect(b.pagadoCentavos).toBe(1190000)
    expect(b.saldoCentavos).toBe(20000)
  })

  it("redondea los importes con deriva de coma flotante", () => {
    const b = parsearBill({ ...creada, total: 36.34, balance: 36.34, totalPaid: 0.1 + 0.2 })
    expect(b.totalCentavos).toBe(3634)
    expect(b.pagadoCentavos).toBe(30)
  })
})

describe("borrarBill", () => {
  it("204 -> borrada", async () => {
    const l = stubFetch({ status: 204 })
    await expect(borrarBill(config, "9001")).resolves.toBe("borrada")
    expect(l[0].init.method).toBe("DELETE")
  })
  it("404 -> no_existe", async () => {
    stubFetch({ status: 404, body: {} })
    await expect(borrarBill(config, "9001")).resolves.toBe("no_existe")
  })
  it("otro error se propaga tipado", async () => {
    stubFetch({ status: 400, body: { message: "Ha ocurrido un error" } })
    await expect(borrarBill(config, "9001")).rejects.toBeInstanceOf(AlegraHttpError)
  })
})

describe("lecturas auxiliares", () => {
  it("listarCategoriasContables usa /categories?format=plain", async () => {
    const l = stubFetch({
      status: 200,
      body: [{ id: "5246", name: "Mercadería en tránsito", type: "asset", use: "movement", idParent: "5047" }],
    })
    const cats = await listarCategoriasContables(config)
    expect(l[0].url).toMatch(/\/categories\?format=plain$/)
    expect(cats).toEqual([{ id: "5246", nombre: "Mercadería en tránsito", tipo: "asset", uso: "movement" }])
  })

  it("listarAlmacenes mapea id, nombre y default", async () => {
    stubFetch({ status: 200, body: [{ id: "wh-1", name: "Principal", isDefault: true, status: "active" }] })
    await expect(listarAlmacenes(config)).resolves.toEqual([{ id: "wh-1", nombre: "Principal", porDefecto: true }])
  })

  it("buscarBills filtra por número en Alegra y por proveedor del lado del CRM", async () => {
    const otro = { ...creada, id: "9100", provider: { id: "901", name: "Otro" } }
    const l = stubFetch({ status: 200, body: [creada, otro] })
    const r = await buscarBills(config, { proveedorId: "900", numero: "PRUEBA-API-00001" })
    expect(l[0].url).toContain("number=PRUEBA-API-00001")
    expect(r.map((b) => b.id)).toEqual(["9001"])
  })

  it("buscarBills descarta coincidencias de otro número aunque Alegra las devuelva", async () => {
    stubFetch({ status: 200, body: [conItems] })
    await expect(buscarBills(config, { proveedorId: "900", numero: "PRUEBA-API-00001" })).resolves.toEqual([])
  })
})

describe("clasificarErrorEscritura", () => {
  it("4xx distinto de 429 = rechazada", () => {
    expect(clasificarErrorEscritura(new AlegraHttpError(400, "/bills", "x"))).toBe("rechazada")
    expect(clasificarErrorEscritura(new AlegraHttpError(404, "/bills", "x"))).toBe("rechazada")
  })
  it("429 = no_aplicada", () => {
    expect(clasificarErrorEscritura(new AlegraRateLimitError("/bills", ""))).toBe("no_aplicada")
  })
  it("5xx, corte de red y timeout = incierta", () => {
    expect(clasificarErrorEscritura(new AlegraHttpError(500, "/bills", ""))).toBe("incierta")
    expect(clasificarErrorEscritura(new AlegraHttpError(503, "/bills", ""))).toBe("incierta")
    expect(clasificarErrorEscritura(new TypeError("fetch failed"))).toBe("incierta")
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" })
    expect(clasificarErrorEscritura(abort)).toBe("incierta")
    const timeout = Object.assign(new Error("timeout"), { name: "TimeoutError" })
    expect(clasificarErrorEscritura(timeout)).toBe("incierta")
  })
  it("un error desconocido se trata como incierto (nunca se asume que no se aplicó)", () => {
    expect(clasificarErrorEscritura(new Error("raro"))).toBe("incierta")
  })
})

describe("errores sin credenciales", () => {
  it("el mensaje del error no incluye el token ni el email", async () => {
    stubFetch({ status: 400, body: { message: "cuentas contables inválida", code: 11029 } })
    const err = await crearBill(config, {
      proveedorId: "900", numero: "X", fecha: "2026-11-15", vencimiento: "2026-11-15", almacenId: "w", observaciones: "",
      lineas: [{ tipo: "cat", id: "5043", precioCentavos: 100, cantidadMilesimas: 1000, taxIds: [] }],
    }).catch((e) => e)
    expect(err).toBeInstanceOf(AlegraHttpError)
    expect(err.status).toBe(400)
    expect(String(err.message)).not.toContain(TOKEN)
    expect(String(err.message)).not.toContain("cuenta@cuenta.example")
  })
})

describe("resolverCategoriaTransito", () => {
  const cat = (id: string, nombre: string, tipo = "asset", uso = "movement"): CategoriaContable => ({ id, nombre, tipo, uso })

  it("una sola coincidencia", () => {
    expect(resolverCategoriaTransito([cat("1", "Caja"), cat("5246", "Mercadería en tránsito")])).toEqual({ ok: true, id: "5246" })
  })
  it("ignora tildes y mayúsculas", () => {
    expect(resolverCategoriaTransito([cat("7", "  MERCADERIA EN TRANSITO ")])).toEqual({ ok: true, id: "7" })
  })
  it("ausente", () => {
    expect(resolverCategoriaTransito([cat("1", "Caja")])).toEqual({ ok: false, motivo: "no_existe", candidatas: [] })
  })
  it("ambigua sin override", () => {
    const r = resolverCategoriaTransito([cat("1", "Mercadería en tránsito"), cat("2", "Mercadería en tránsito")])
    expect(r).toEqual({ ok: false, motivo: "ambigua", candidatas: ["1", "2"] })
  })
  it("con override por id resuelve aunque sea ambigua", () => {
    const cats = [cat("1", "Mercadería en tránsito"), cat("2", "Mercadería en tránsito")]
    expect(resolverCategoriaTransito(cats, { overrideId: "2" })).toEqual({ ok: true, id: "2" })
  })
  it("un override inexistente no se acepta a ciegas", () => {
    expect(resolverCategoriaTransito([cat("1", "Mercadería en tránsito")], { overrideId: "999" })).toMatchObject({
      ok: false,
      motivo: "no_existe",
    })
  })
  it("nombre configurado distinto", () => {
    expect(resolverCategoriaTransito([cat("9", "Compras en camino")], { nombre: "compras en camino" })).toEqual({ ok: true, id: "9" })
  })
  it("sólo cuentan las de tipo asset", () => {
    expect(resolverCategoriaTransito([cat("1", "Mercadería en tránsito", "expense")])).toMatchObject({ ok: false, motivo: "no_existe" })
  })
})
