import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { ComprobantePedidoDto, CuentaPagoDto, PagoRegistradoDto } from "@/lib/pedidos-repo"
import { PagosComprobantes } from "./PagosComprobantes"

// Render del bloque "Pagos y comprobantes" del detalle (cuenta congelada, comprobantes con su
// enlace y pagos registrados). Datos inventados.

const cuenta: CuentaPagoDto = {
  alias: "tienda.demo",
  cbu: "0000000000000000000000",
  banco: "Banco Demo",
  titular: "Tienda Demo SA",
  cuit: "30000000000",
}
const comprobante = (over: Partial<ComprobantePedidoDto> = {}): ComprobantePedidoDto => ({
  id: "c1",
  monto: 1210,
  fecha: "2026-09-30",
  estado: "pending",
  subidoEn: "2026-09-30T15:00:00.000Z",
  tieneArchivo: true,
  mime: "application/pdf",
  nombreArchivo: "constancia.pdf",
  ...over,
})
const pago = (over: Partial<PagoRegistradoDto> = {}): PagoRegistradoDto => ({
  id: "p1",
  monto: 1210,
  fecha: "2026-09-30",
  referencia: "Op. 998877",
  receiptId: "c1",
  registradoPorNombre: "Ope Rador",
  creadoEn: "2026-10-01T12:00:00.000Z",
  anulado: null,
  ...over,
})

const render = (props: { pedidoId?: string; cuentaPago?: CuentaPagoDto | null; comprobantes?: ComprobantePedidoDto[]; pagos?: PagoRegistradoDto[] }) =>
  renderToStaticMarkup(
    createElement(PagosComprobantes, { pedidoId: "ped-1", cuentaPago: null, comprobantes: [], pagos: [], ...props }),
  )

describe("PagosComprobantes", () => {
  it("sin nada que mostrar no renderiza el bloque", () => {
    expect(render({})).toBe("")
  })

  it("muestra la cuenta congelada del pedido", () => {
    const html = render({ cuentaPago: cuenta })
    for (const dato of ["tienda.demo", "0000000000000000000000", "Banco Demo", "Tienda Demo SA", "30000000000"]) {
      expect(html).toContain(dato)
    }
    expect(html).toContain("Cuenta informada al comprador")
  })

  it("cada comprobante con archivo tiene su enlace al visor del pedido; sin archivo no hay enlace", () => {
    const html = render({ comprobantes: [comprobante(), comprobante({ id: "c2", tieneArchivo: false })] })
    expect(html).toContain('href="/api/admin/pedidos/ped-1/comprobantes/c1/file"')
    expect(html).not.toContain("comprobantes/c2/file")
    expect(html).toContain("Por revisar")
  })

  it("sin comprobantes dice 'Sin comprobante'", () => {
    expect(render({ cuentaPago: cuenta })).toContain("Sin comprobante")
  })

  it("lista los pagos registrados y marca los anulados", () => {
    const html = render({
      pagos: [pago({ id: "p2" }), pago({ id: "p1", anulado: { en: "2026-10-01T13:00:00.000Z", porNombre: "Ana" } })],
    })
    expect(html).toContain("Op. 998877")
    expect(html).toContain("Ope Rador")
    expect(html).toContain("Anulado")
    expect(html).toContain("Ana")
  })
})
