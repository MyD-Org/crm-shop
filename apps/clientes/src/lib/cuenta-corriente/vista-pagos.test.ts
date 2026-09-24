import { describe, expect, it } from "vitest";
import type { ComprobanteCliente } from "../comprobantes/repo";
import type { Pago } from "./tipos";
import { PAGO_INFORMADO, datosFila, filasPagos } from "./vista-pagos";

const comprobante = (id: string, status: ComprobanteCliente["status"]) =>
  ({
    id,
    status,
    paidOn: "2026-09-23",
    method: "transferencia",
    methodOther: null,
    amount: "150000.50",
    submittedAt: "2026-09-23T12:00:00Z",
    pagoAlegra: status === "loaded" ? "1045" : null,
  }) as unknown as ComprobanteCliente;

const pago: Pago = { id: "1045", fecha: "15/09/2026", facturas: [], medio: "Efectivo", monto: 212500, alegraId: "a1" };

describe("filasPagos", () => {
  it("informados en revisión arriba, después los recibos", () => {
    const filas = filasPagos([comprobante("c1", "pending")], [pago]);
    expect(filas.map((f) => f.tipo)).toEqual(["informado", "recibo"]);
    expect(filas.map((f) => f.clave)).toEqual(["informado:c1", "recibo:a1"]);
  });

  it("un comprobante ya registrado no se repite: se ve como su recibo", () => {
    const filas = filasPagos([comprobante("c1", "loaded")], [pago]);
    expect(filas).toHaveLength(1);
    expect(filas[0].tipo).toBe("recibo");
  });

  it("sin nada: sin filas", () => {
    expect(filasPagos([], [])).toEqual([]);
  });
});

describe("datosFila", () => {
  it("recibo: sus datos tal cual", () => {
    const [f] = filasPagos([], [pago]);
    expect(datosFila(f)).toEqual({ id: "1045", fecha: "15/09/2026", medio: "Efectivo", monto: 212500 });
  });

  it("informado: rótulo propio, fecha corta, medio y monto numérico", () => {
    const [f] = filasPagos([comprobante("c1", "pending")], []);
    expect(datosFila(f)).toEqual({ id: PAGO_INFORMADO, fecha: "23/09/2026", medio: "Transferencia", monto: 150000.5 });
  });
});
