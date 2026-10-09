import { describe, expect, it } from "vitest"
import { cuentaDeCobroDto, parseInfoPago, textoMedioCobrado, type PagoEnLineaDto } from "./pago-en-linea"
import { toPagoEnLineaDto } from "./pedidos-repo"
import { datosCobroEnLinea, fmtMoneda } from "@/components/admin/pedidos/format"

// Datos inventados.

const vacio = parseInfoPago(null)

describe("parseInfoPago", () => {
  it("lee los campos válidos y descarta lo que no tiene la forma esperada", () => {
    expect(
      parseInfoPago({ tipo: "credito", marca: "Mastercard", ultimos4: "4623", aprobadoEn: "2026-10-07T19:30:00Z", autorizacion: "123456" }),
    ).toEqual({
      tipo: "credito",
      marca: "Mastercard",
      ultimos4: "4623",
      aprobadoEn: "2026-10-07T19:30:00.000Z",
      autorizacion: "123456",
      cupon: null,
      netoRecibido: null,
      costoProcesador: null,
      cuentaCobro: null,
      cuentaCobroPrevista: null,
    })
    expect(parseInfoPago({ netoRecibido: 8790.35, costoProcesador: 1209.65 })).toEqual({
      ...vacio,
      netoRecibido: 8790.35,
      costoProcesador: 1209.65,
    })
    expect(parseInfoPago({ netoRecibido: "8790", costoProcesador: -1 })).toEqual(vacio)
    expect(parseInfoPago({ tipo: "otro", ultimos4: "12", aprobadoEn: "ayer", marca: 3 })).toEqual(vacio)
    expect(parseInfoPago("x")).toEqual(vacio)
    expect(parseInfoPago([1])).toEqual(vacio)
  })
})

describe("parseInfoPago: cuenta de cobro", () => {
  it("lee cuentaCobro y cuentaCobroPrevista (slugs de sucursal)", () => {
    const info = parseInfoPago({ cuentaCobro: "igz", cuentaCobroPrevista: "mdp" })
    expect(info.cuentaCobro).toBe("igz")
    expect(info.cuentaCobroPrevista).toBe("mdp")
    expect(parseInfoPago({ cuentaCobro: "mar-del-plata" }).cuentaCobro).toBe("mar-del-plata")
  })
  it("descarta lo que no es un slug válido", () => {
    for (const malo of ["", "x", "IGZ", "con espacio", "a".repeat(21), "mdp;drop", 7, null, {}]) {
      const info = parseInfoPago({ cuentaCobro: malo, cuentaCobroPrevista: malo })
      expect(info.cuentaCobro).toBeNull()
      expect(info.cuentaCobroPrevista).toBeNull()
    }
  })
  it("pago anterior a la cuenta de cobro: ambos null y el resto igual", () => {
    const info = parseInfoPago({ tipo: "credito", marca: "Visa" })
    expect(info).toEqual({ ...vacio, tipo: "credito", marca: "Visa" })
    expect(info.cuentaCobro).toBeNull()
    expect(info.cuentaCobroPrevista).toBeNull()
  })
})

describe("cuentaDeCobroDto", () => {
  const info = (cuentaCobro: string | null, cuentaCobroPrevista: string | null) => ({ ...vacio, cuentaCobro, cuentaCobroPrevista })
  it("sin cuentaCobro → null (pago viejo)", () => {
    expect(cuentaDeCobroDto(info(null, null))).toBeNull()
    expect(cuentaDeCobroDto(info(null, "mdp"))).toBeNull()
  })
  it("sin prevista distinta → no es fallback", () => {
    expect(cuentaDeCobroDto(info("mdp", null))).toEqual({ slug: "mdp", prevista: null, fallback: false })
    expect(cuentaDeCobroDto(info("mdp", "mdp"))).toEqual({ slug: "mdp", prevista: null, fallback: false })
  })
  it("prevista distinta → fallback", () => {
    expect(cuentaDeCobroDto(info("igz", "mdp"))).toEqual({ slug: "igz", prevista: "mdp", fallback: true })
  })
})

describe("textoMedioCobrado", () => {
  const p = (medio: string | null, info: Partial<PagoEnLineaDto["info"]>) => ({ medio, info: { ...vacio, ...info } })

  it("tarjeta con todos los datos", () => {
    expect(textoMedioCobrado(p("tarjeta", { tipo: "credito", marca: "Mastercard", ultimos4: "4623" }))).toBe(
      "Mastercard crédito •••• 4623",
    )
  })
  it("dinero en cuenta y tarjeta desde la cuenta de Mercado Pago", () => {
    expect(textoMedioCobrado(p("cuenta_mp", { tipo: "dinero_en_cuenta" }))).toBe("Dinero en cuenta de Mercado Pago")
    expect(textoMedioCobrado(p("cuenta_mp", { tipo: "debito", marca: "Visa" }))).toBe(
      "Visa débito (desde la cuenta de Mercado Pago)",
    )
  })
  it("sin marca y pagos anteriores sin info", () => {
    expect(textoMedioCobrado(p("tarjeta", { tipo: "credito" }))).toBe("Tarjeta de crédito")
    expect(textoMedioCobrado(p("tarjeta", {}))).toBe("Tarjeta")
    expect(textoMedioCobrado(p("cuenta_mp", {}))).toBe("Cuenta de Mercado Pago")
    expect(textoMedioCobrado(p(null, {}))).toBeNull()
  })
})

describe("toPagoEnLineaDto", () => {
  const fila = {
    pagoProveedor: "mercadopago",
    pagoReferencia: "1234567890",
    pagoMedio: "tarjeta",
    pagoCuotas: 6,
    pagoTotalPagado: "1210.00",
    pagoInfo: { tipo: "credito", marca: "Visa" },
  }
  it("pago offline (sin proveedor) → null", () => {
    expect(toPagoEnLineaDto({ ...fila, pagoProveedor: null })).toBeNull()
  })
  it("cobro en línea", () => {
    expect(toPagoEnLineaDto(fila)).toEqual({
      proveedor: "mercadopago",
      referencia: "1234567890",
      medio: "tarjeta",
      cuotas: 6,
      totalPagado: 1210,
      info: { ...vacio, tipo: "credito", marca: "Visa" },
      cuenta: null,
    })
  })
  it("expone la forma de pago elegida solo si el Shop la congeló", () => {
    expect(toPagoEnLineaDto({ ...fila, formaCobro: "debito" })?.formaElegida).toBe("debito")
    expect(toPagoEnLineaDto({ ...fila, formaCobro: "cuenta_mp" })?.formaElegida).toBe("cuenta_mp")
    // NULL (pedido anterior o sin precios por forma) o un valor desconocido: sin la clave.
    expect(toPagoEnLineaDto({ ...fila, formaCobro: null })).not.toHaveProperty("formaElegida")
    expect(toPagoEnLineaDto({ ...fila, formaCobro: "efectivo" })).not.toHaveProperty("formaElegida")
  })
  it("expone la cuenta de cobro y el fallback", () => {
    const dto = toPagoEnLineaDto({ ...fila, pagoInfo: { cuentaCobro: "igz", cuentaCobroPrevista: "mdp" } })
    expect(dto?.cuenta).toEqual({ slug: "igz", prevista: "mdp", fallback: true })
    expect(toPagoEnLineaDto({ ...fila, pagoInfo: { cuentaCobro: "mdp" } })?.cuenta).toEqual({ slug: "mdp", prevista: null, fallback: false })
  })
})

describe("datosCobroEnLinea", () => {
  const base: PagoEnLineaDto = {
    proveedor: "mercadopago",
    referencia: "1234567890",
    medio: "tarjeta",
    cuotas: 6,
    totalPagado: 1210,
    info: { ...vacio, tipo: "credito", marca: "Mastercard", ultimos4: "4623", aprobadoEn: "2026-10-07T19:30:00.000Z" },
    cuenta: null,
  }
  it("muestra la forma de pago elegida, antes de la cuenta de cobro", () => {
    const d = datosCobroEnLinea({ ...base, formaElegida: "debito", cuenta: { slug: "mdp", prevista: null, fallback: false } }, 1210)
    expect(d.map((x) => x.label).slice(0, 3)).toEqual(["Pagó con", "Forma de pago elegida", "Cuenta de cobro"])
    expect(d[1].valor).toBe("Tarjeta de débito")
    expect(datosCobroEnLinea({ ...base, formaElegida: "cuenta_mp" }, 1210)[1].valor).toBe("Cuenta de Mercado Pago")
    expect(datosCobroEnLinea(base, 1210).map((x) => x.label)).not.toContain("Forma de pago elegida")
  })
  it("Mercado Pago: medio, cuotas, fecha y número de operación; total sólo si difiere", () => {
    expect(datosCobroEnLinea(base, 1210)).toEqual([
      { label: "Pagó con", valor: "Mastercard crédito •••• 4623" },
      { label: "Cuotas", valor: "6 cuotas" },
      { label: "Fecha del pago", valor: "07/10/2026, 16:30" },
      { label: "N° de operación de Mercado Pago", valor: "1234567890" },
    ])
    expect(datosCobroEnLinea(base, 1100).map((d) => d.label)).toContain("Total pagado por el cliente")
  })
  it("neto y cargos de Mercado Pago, debajo del total; sin neto no se muestra el costo", () => {
    const conNeto: PagoEnLineaDto = { ...base, info: { ...base.info, netoRecibido: 8790.35, costoProcesador: 1209.65 } }
    const datos = datosCobroEnLinea(conNeto, 1210)
    expect(datos.slice(2, 4)).toEqual([
      { label: "Recibe neto", valor: fmtMoneda(8790.35) },
      { label: "Comisión y costos de Mercado Pago", valor: fmtMoneda(1209.65) },
    ])
    const soloCosto: PagoEnLineaDto = { ...base, info: { ...base.info, costoProcesador: 1209.65 } }
    expect(datosCobroEnLinea(soloCosto, 1210).map((d) => d.label)).not.toContain("Comisión y costos de Mercado Pago")
    expect(datosCobroEnLinea(base, 1210).map((d) => d.label)).not.toContain("Recibe neto")
  })
  it("cuenta de cobro: fila con el nombre de la sucursal (o el slug si ya no existe); pagos viejos sin fila", () => {
    const conCuenta: PagoEnLineaDto = { ...base, cuenta: { slug: "mdp", prevista: null, fallback: false } }
    expect(datosCobroEnLinea(conCuenta, 1210, { mdp: "Mar del Plata" })[1]).toEqual({ label: "Cuenta de cobro", valor: "Mar del Plata" })
    expect(datosCobroEnLinea(conCuenta, 1210).find((d) => d.label === "Cuenta de cobro")?.valor).toBe("mdp")
    expect(datosCobroEnLinea(base, 1210).map((d) => d.label)).not.toContain("Cuenta de cobro")
  })
  it("Payway: cupón y autorización, sin el id interno", () => {
    const payway: PagoEnLineaDto = {
      ...base,
      proveedor: "payway",
      referencia: "0123456789abcdef0123456789abcdef",
      cuotas: 1,
      info: { ...vacio, tipo: "debito", marca: "Visa", cupon: "1560", autorizacion: "180644" },
    }
    expect(datosCobroEnLinea(payway, 1210)).toEqual([
      { label: "Pagó con", valor: "Visa débito" },
      { label: "Cuotas", valor: "1 pago" },
      { label: "Cupón", valor: "1560" },
      { label: "Código de autorización", valor: "180644" },
    ])
  })
})
