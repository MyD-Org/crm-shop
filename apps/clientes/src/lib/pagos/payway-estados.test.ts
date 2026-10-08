import { describe, expect, it } from "vitest";
import aprobado from "./__fixtures__/payway/pago-aprobado.json";
import rechazado51 from "./__fixtures__/payway/pago-rechazado-51.json";
import rechazado05 from "./__fixtures__/payway/pago-rechazado-05.json";
import anulado from "./__fixtures__/payway/pago-anulado.json";
import enRevision from "./__fixtures__/payway/pago-en-revision.json";
import {
  centavos,
  esDebito,
  idMedioPago,
  idsMedioPermitidos,
  interpretarPago,
  motivoDeRechazo,
  referenciaDeIntento,
} from "./payway-estados";

describe("centavos", () => {
  it("convierte pesos a centavos enteros sin errores de coma flotante", () => {
    expect(centavos(10)).toBe(1000);
    expect(centavos(0.1 + 0.2)).toBe(30);
    expect(centavos(1234.56)).toBe(123456);
    expect(centavos(19.99)).toBe(1999);
    expect(centavos(1.005)).toBe(101);
  });

  it("rechaza lo que no sea un monto positivo que entre en 12 dígitos", () => {
    for (const malo of [0, -5, NaN, Infinity, 0.004, 10_000_000_000, "10" as unknown as number]) {
      expect(() => centavos(malo)).toThrow();
    }
    expect(centavos(9_999_999_999.99)).toBe(999_999_999_999);
  });
});

describe("referenciaDeIntento", () => {
  it("es el id del intento sin guiones: alfanumérico y de 32 caracteres (máx. 40)", () => {
    const r = referenciaDeIntento("123e4567-e89b-42d3-a456-426614174000");
    expect(r).toBe("123e4567e89b42d3a456426614174000");
    expect(r).toMatch(/^[a-z0-9]{1,40}$/i);
  });

  it("rechaza un id vacío o que no sirve como site_transaction_id", () => {
    expect(() => referenciaDeIntento("")).toThrow();
    expect(() => referenciaDeIntento("x".repeat(41))).toThrow();
    expect(() => referenciaDeIntento("con espacio")).toThrow();
  });
});

describe("interpretarPago", () => {
  it("aprobado: pagado, con site_transaction_id como referencia y el monto en pesos", () => {
    const e = interpretarPago(aprobado);
    expect(e.estado).toBe("pagado");
    expect(e.referencia).toBe(aprobado.site_transaction_id);
    expect(e.cuotasPagadas).toBe(1);
    expect(e.totalPagado).toBe(10);
    expect(e.reversion).toBeFalsy();
    expect(e.motivo).toBeUndefined();
    expect(e.detalle).toContain("payment_id=15403386");
    expect(e.detalle).toContain("status=approved");
  });

  it("rechazado por fondos: fallido con motivo", () => {
    const e = interpretarPago(rechazado51);
    expect(e.estado).toBe("fallido");
    expect(e.motivo).toBe("fondos");
    expect(e.detalle).toContain("reason=51");
  });

  it("rechazado 05: banco_rechazo", () => {
    expect(interpretarPago(rechazado05).motivo).toBe("banco_rechazo");
  });

  it("anulado: fallido con reversión (es lo que desmarca un pedido pagado)", () => {
    const e = interpretarPago(anulado);
    expect(e.estado).toBe("fallido");
    expect(e.reversion).toBe(true);
  });

  it("en revisión: pendiente", () => {
    const e = interpretarPago(enRevision);
    expect(e.estado).toBe("pendiente");
    expect(e.reversion).toBeFalsy();
  });

  it.each([
    ["approved", "pagado", false],
    ["APPROVED", "pagado", false],
    ["accredited", "pagado", false],
    ["approved_with_refund", "pagado", false],
    ["annulled", "fallido", true],
    ["annulment_approved", "fallido", true],
    ["refunded", "fallido", true],
    ["refunded_approved", "fallido", true],
    ["rejected", "fallido", false],
    ["pre_approved", "pendiente", false],
    ["preapproved", "pendiente", false],
    ["process", "pendiente", false],
    ["review", "pendiente", false],
    ["algo_nuevo", "pendiente", false],
  ])("status %s -> %s (reversión %s)", (status, estado, reversion) => {
    const e = interpretarPago({ ...aprobado, status });
    expect(e.estado).toBe(estado);
    expect(Boolean(e.reversion)).toBe(reversion);
  });

  it("sin status: pendiente (nunca se asume que se cobró)", () => {
    const sinStatus: Record<string, unknown> = { ...aprobado };
    delete sinStatus.status;
    expect(interpretarPago(sinStatus).estado).toBe("pendiente");
  });

  it("rechazo del control de fraude (cybersource_error): motivo propio, aunque el reason sea -1", () => {
    const e = interpretarPago({
      ...rechazado51,
      status_details: { error: { type: "cybersource_error", reason: { id: -1 } } },
    });
    expect(e.estado).toBe("fallido");
    expect(e.motivo).toBe("control_seguridad");
    expect(e.detalle).toContain("error=cybersource");
  });

  it("rechazado sin código de motivo: desconocido", () => {
    const e = interpretarPago({ ...rechazado51, status_details: { error: null } });
    expect(e.motivo).toBe("desconocido");
  });

  it("lleva las cuotas informadas y descarta las inválidas", () => {
    expect(interpretarPago({ ...aprobado, installments: 3 }).cuotasPagadas).toBe(3);
    expect(interpretarPago({ ...aprobado, installments: 0 }).cuotasPagadas).toBeUndefined();
  });

  it("totalPagado sale del amount en centavos; un amount inválido no inventa un total", () => {
    expect(interpretarPago({ ...aprobado, amount: 123456 }).totalPagado).toBe(1234.56);
    expect(interpretarPago({ ...aprobado, amount: undefined }).totalPagado).toBeUndefined();
    expect(interpretarPago({ ...aprobado, amount: -1 }).totalPagado).toBeUndefined();
  });
});

describe("motivoDeRechazo", () => {
  it.each([
    [51, "fondos"],
    [61, "limite"],
    [65, "limite"],
    [45, "cuotas_no_disponibles"],
    [48, "cuotas_no_disponibles"],
    [77, "cuotas_no_disponibles"],
    [14, "datos_invalidos"],
    [46, "datos_invalidos"],
    [49, "datos_invalidos"],
    [54, "datos_invalidos"],
    [5, "banco_rechazo"],
    [4, "banco_rechazo"],
    [7, "banco_rechazo"],
    [41, "banco_rechazo"],
    [43, "banco_rechazo"],
    [53, "tarjeta_inhabilitada"],
    [56, "tarjeta_inhabilitada"],
    [62, "tarjeta_inhabilitada"],
    [57, "no_aprobado"],
    [58, "desconocido"],
    [1, "requiere_autorizacion"],
    [2, "requiere_autorizacion"],
    [76, "requiere_autorizacion"],
    [38, "demasiados_intentos"],
    [3, "desconocido"],
    [95, "desconocido"],
    [9999, "desconocido"],
  ])("código %s -> %s", (id, motivo) => {
    expect(motivoDeRechazo(id)).toBe(motivo);
  });

  it("acepta el código como texto con cero a la izquierda y devuelve desconocido si no es un número", () => {
    expect(motivoDeRechazo("05")).toBe("banco_rechazo");
    expect(motivoDeRechazo(undefined)).toBe("desconocido");
    expect(motivoDeRechazo("xx")).toBe("desconocido");
  });
});

describe("payment_method_id", () => {
  it("tabla oficial: Mastercard crédito es 104 (no 15) y los débitos tienen ids propios", () => {
    expect(idMedioPago("visa", "credito")).toBe(1);
    expect(idMedioPago("visa", "debito")).toBe(31);
    expect(idMedioPago("mastercard", "credito")).toBe(104);
    expect(idMedioPago("mastercard", "debito")).toBe(105);
    expect(idMedioPago("maestro", "debito")).toBe(106);
    expect(idMedioPago("amex", "credito")).toBe(65);
    expect(idMedioPago("cabal", "credito")).toBe(63);
    expect(idMedioPago("cabal", "debito")).toBe(108);
    expect(idMedioPago("naranja", "credito")).toBe(24);
  });

  it("una marca sin esa modalidad no tiene id", () => {
    expect(idMedioPago("amex", "debito")).toBeNull();
    expect(idMedioPago("maestro", "credito")).toBeNull();
    expect(idMedioPago("inexistente", "credito")).toBeNull();
  });

  it("esDebito distingue los débitos", () => {
    expect([31, 105, 106, 108].every(esDebito)).toBe(true);
    expect([1, 104, 65, 63].some(esDebito)).toBe(false);
  });

  it("la lista cerrada incluye crédito y débito y deja afuera los medios offline", () => {
    const ids = idsMedioPermitidos();
    for (const id of [1, 31, 104, 105, 106, 65, 63, 108, 24]) expect(ids.has(id)).toBe(true);
    for (const offline of [25, 26, 48, 51]) expect(ids.has(offline)).toBe(false);
  });
});
