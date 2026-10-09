import { describe, expect, it } from "vitest";
import {
  MONEDA_PEDIDO,
  motivoNoAcreditable,
  requierePlanesMP,
  revisionDeCuotas,
  validarCuotasPago,
  type EntradaValidacionCuotas,
} from "./cuotas-validacion";
import type { PlanMP } from "./mercadopago-planes";

const plan = (cuotas: number, conInteres = true): PlanMP => ({
  cuotas,
  montoCuota: 1,
  total: 1,
  tasaPct: conInteres ? 10 : 0,
  cft: conInteres ? "100,00" : null,
  tea: conInteres ? "80,00" : null,
  conInteres,
});
const planesOk = { ok: true as const, entrada: { metodoPagoId: "visa", emisor: null, logo: null, planes: [plan(3), plan(6), plan(12)] } };

const base: EntradaValidacionCuotas = {
  cuotas: 6,
  medio: "tarjeta",
  cuotasPedido: 6,
  procesadorId: "mercadopago",
  opcion: "credito",
  marca: "visa",
  marcasCondicion: null,
  totalPedido: 1200,
  planes: null,
};
const validar = (p: Partial<EntradaValidacionCuotas>) => validarCuotasPago({ ...base, ...p });
const rechazo = (motivo: string) => ({ ok: false, motivo });
const sinInteres = (cuotas: number, total = 1200) => ({
  ok: true,
  cuotas,
  intencion: { cuotas, totalEsperado: total, conInteres: false },
});

describe("validarCuotasPago: cuotas sin interés congeladas en el pedido = IGUALDAD estricta", () => {
  it("las mismas cuotas pasan, con la intención sin interés", () => {
    expect(validar({})).toEqual(sinInteres(6));
    expect(validar({ cuotas: 3, cuotasPedido: 3 })).toEqual(sinInteres(3));
  });

  it("MENOS o MÁS cuotas que las congeladas se rechaza", () => {
    expect(validar({ cuotas: 3 })).toEqual(rechazo("cuotas_distintas"));
    expect(validar({ cuotas: 1 })).toEqual(rechazo("cuotas_distintas"));
    expect(validar({ cuotas: 12, planes: planesOk })).toEqual(rechazo("cuotas_distintas"));
  });

  it("sin cuotas en el body con un pedido en N >= 2: rechazo (no se asume)", () => {
    expect(validar({ cuotas: undefined })).toEqual(rechazo("cuotas_distintas"));
  });

  it.each([0, -3, "abc", 2.5, Number.NaN, "6", null, {}, 25])("cuotas %s → rechazo", (cuotas) => {
    expect(validar({ cuotas })).toEqual(rechazo("cuotas_distintas"));
  });

  it("marca no incluida en la condición → marca_no_permitida", () => {
    expect(validar({ marcasCondicion: ["visa", "mastercard"], marca: "amex" })).toEqual(rechazo("marca_no_permitida"));
  });

  it("marca desconocida con condición restringida → marca_no_permitida; sin restricción pasa", () => {
    expect(validar({ marcasCondicion: ["visa"], marca: null })).toEqual(rechazo("marca_no_permitida"));
    expect(validar({ marcasCondicion: null, marca: null })).toEqual(sinInteres(6));
  });

  it("marca incluida pasa", () => {
    expect(validar({ marcasCondicion: ["visa", "mastercard"], marca: "mastercard" })).toEqual(sinInteres(6));
  });

  it("Payway: mismas reglas sin interés", () => {
    expect(validar({ procesadorId: "payway", marcasCondicion: ["visa"], marca: "naranja" })).toEqual(
      rechazo("marca_no_permitida"),
    );
    expect(validar({ procesadorId: "payway" })).toEqual(sinInteres(6));
  });
});

describe("validarCuotasPago: 1 pago", () => {
  it.each([1, null])("pedido en %s: 1 (o ausente) pasa", (cuotasPedido) => {
    expect(validar({ cuotasPedido, cuotas: 1 })).toEqual(sinInteres(1));
    expect(validar({ cuotasPedido, cuotas: undefined })).toEqual(sinInteres(1));
  });

  it("no consulta planes ni exige marca", () => {
    expect(requierePlanesMP({ ...base, cuotas: 1, cuotasPedido: 1 })).toBe(false);
    expect(validar({ cuotasPedido: 1, cuotas: 1, marca: null, marcasCondicion: ["visa"] })).toEqual(sinInteres(1));
  });
});

describe("validarCuotasPago: cuotas con interés de Mercado Pago (pedido en 1 pago o sin congelar)", () => {
  const conInteres = { cuotasPedido: 1, cuotas: 6, planes: planesOk };

  it("N dentro del plan de MP para el BIN: pasa con intención con interés y el total del pedido", () => {
    expect(validar(conInteres)).toEqual({
      ok: true,
      cuotas: 6,
      intencion: { cuotas: 6, totalEsperado: 1200, conInteres: true },
    });
  });

  it("pedido sin cuotas congeladas (null): ya NO acepta cualquier 1..24, exige el plan", () => {
    expect(validar({ ...conInteres, cuotasPedido: null }).ok).toBe(true);
    expect(validar({ ...conInteres, cuotasPedido: null, cuotas: 7 })).toEqual(rechazo("cuotas_distintas"));
  });

  it("N fuera del plan → cuotas_distintas", () => {
    expect(validar({ ...conInteres, cuotas: 18 })).toEqual(rechazo("cuotas_distintas"));
  });

  it("plan de MP sin interés (a cargo del vendedor): pasa con intención sin interés", () => {
    const planes = { ok: true as const, entrada: { ...planesOk.entrada, planes: [plan(3, false)] } };
    expect(validar({ ...conInteres, cuotas: 3, planes })).toEqual({
      ok: true,
      cuotas: 3,
      intencion: { cuotas: 3, totalEsperado: 1200, conInteres: false },
    });
  });

  it("MP caído (o no consultado) → planes_no_disponibles", () => {
    expect(validar({ ...conInteres, planes: { ok: false } })).toEqual(rechazo("planes_no_disponibles"));
    expect(validar({ ...conInteres, planes: null })).toEqual(rechazo("planes_no_disponibles"));
  });

  it("MP respondió sin planes de crédito para la tarjeta → cuotas_no_disponibles", () => {
    expect(validar({ ...conInteres, planes: { ok: true, entrada: null } })).toEqual(rechazo("cuotas_no_disponibles"));
  });

  it("sólo tarjeta de crédito: débito o cuenta de Mercado Pago → cuotas_no_disponibles", () => {
    expect(validar({ ...conInteres, opcion: "debito" })).toEqual(rechazo("cuotas_no_disponibles"));
    expect(validar({ ...conInteres, medio: "cuenta_mp", opcion: "cuenta_mp" })).toEqual(rechazo("cuotas_no_disponibles"));
  });

  it("sólo Mercado Pago: Payway con interés → cuotas_no_disponibles", () => {
    expect(validar({ ...conInteres, procesadorId: "payway" })).toEqual(rechazo("cuotas_no_disponibles"));
  });

  it("requierePlanesMP: sólo MP, crédito, N >= 2 sobre un pedido en 1 pago o sin congelar", () => {
    expect(requierePlanesMP({ ...base, ...conInteres })).toBe(true);
    expect(requierePlanesMP({ ...base, ...conInteres, cuotasPedido: null })).toBe(true);
    expect(requierePlanesMP({ ...base, ...conInteres, cuotasPedido: 6 })).toBe(false);
    expect(requierePlanesMP({ ...base, ...conInteres, procesadorId: "payway" })).toBe(false);
    expect(requierePlanesMP({ ...base, ...conInteres, opcion: "debito" })).toBe(false);
    expect(requierePlanesMP({ ...base, ...conInteres, cuotas: "6" })).toBe(false);
  });
});

describe("revisionDeCuotas (reconciliación contra lo que informó el procesador)", () => {
  const pedido = { cuotas: 6, total: 1200 };

  it("coincide: sin revisión", () => {
    expect(revisionDeCuotas(pedido, { cuotas: 6, totalPagado: 1200 })).toBeNull();
  });

  it("cuotas distintas: cuotas_distintas", () => {
    expect(revisionDeCuotas(pedido, { cuotas: 12, totalPagado: 1200 })).toBe("cuotas_distintas");
  });

  it("monto distinto (el procesador cobró interés): monto_distinto", () => {
    expect(revisionDeCuotas(pedido, { cuotas: 6, totalPagado: 1290 })).toBe("monto_distinto");
  });

  it("tolera un centavo de diferencia", () => {
    expect(revisionDeCuotas(pedido, { cuotas: 6, totalPagado: 1200.01 })).toBeNull();
    expect(revisionDeCuotas(pedido, { cuotas: 6, totalPagado: 1200.02 })).toBe("monto_distinto");
  });

  it("si cuotas y monto difieren, manda la discrepancia de cuotas", () => {
    expect(revisionDeCuotas(pedido, { cuotas: 3, totalPagado: 1300 })).toBe("cuotas_distintas");
  });

  it("datos que el procesador no informó no se acusan", () => {
    expect(revisionDeCuotas(pedido, {})).toBeNull();
    expect(revisionDeCuotas(pedido, { cuotas: 6 })).toBeNull();
  });

  it("pedido sin cuotas congeladas (anterior o flag apagado): nunca se revisa", () => {
    expect(revisionDeCuotas({ cuotas: null, total: 1200 }, { cuotas: 12, totalPagado: 2000 })).toBeNull();
  });
});

describe("revisionDeCuotas con la intención del intento (migración 0034)", () => {
  const conInteres = (cuotas: number, totalEsperado: number) => ({ cuotas, totalEsperado, conInteres: true });
  const sinInteres = (cuotas: number, totalEsperado: number) => ({ cuotas, totalEsperado, conInteres: false });

  it("con interés elegido: mismas cuotas y total mayor (el interés) → sin marca", () => {
    expect(
      revisionDeCuotas({ cuotas: 1, total: 50000 }, { cuotas: 6, totalPagado: 66070 }, conInteres(6, 50000)),
    ).toBeNull();
  });

  it("con interés: el pedido en 1 pago o sin cuotas congeladas (null) igual se revisa", () => {
    expect(
      revisionDeCuotas({ cuotas: null, total: 50000 }, { cuotas: 3, totalPagado: 59845 }, conInteres(6, 50000)),
    ).toBe("cuotas_distintas");
    expect(
      revisionDeCuotas({ cuotas: null, total: 50000 }, { cuotas: 6, totalPagado: 66070 }, conInteres(6, 50000)),
    ).toBeNull();
  });

  it("con interés: cuotas pagadas distintas de las pedidas → cuotas_distintas", () => {
    expect(
      revisionDeCuotas({ cuotas: 1, total: 50000 }, { cuotas: 3, totalPagado: 66070 }, conInteres(6, 50000)),
    ).toBe("cuotas_distintas");
  });

  it("con interés: total pagado MENOR al esperado → monto_distinto", () => {
    expect(
      revisionDeCuotas({ cuotas: 1, total: 50000 }, { cuotas: 6, totalPagado: 40000 }, conInteres(6, 50000)),
    ).toBe("monto_distinto");
  });

  it("con interés: tolera el redondeo de las cuotas (un centavo por cuota)", () => {
    expect(
      revisionDeCuotas({ cuotas: 1, total: 50000 }, { cuotas: 6, totalPagado: 49999.95 }, conInteres(6, 50000)),
    ).toBeNull();
    expect(
      revisionDeCuotas({ cuotas: 1, total: 50000 }, { cuotas: 6, totalPagado: 49999.93 }, conInteres(6, 50000)),
    ).toBe("monto_distinto");
    // Con una sola cuota la tolerancia sigue siendo un centavo.
    expect(
      revisionDeCuotas({ cuotas: 1, total: 50000 }, { cuotas: 1, totalPagado: 49999.98 }, conInteres(1, 50000)),
    ).toBe("monto_distinto");
  });

  it("sin interés con intención: contra lo pedido, igual que antes (total distinto → monto_distinto)", () => {
    expect(
      revisionDeCuotas({ cuotas: 3, total: 52000 }, { cuotas: 3, totalPagado: 60000 }, sinInteres(3, 52000)),
    ).toBe("monto_distinto");
    expect(
      revisionDeCuotas({ cuotas: 3, total: 52000 }, { cuotas: 3, totalPagado: 52000 }, sinInteres(3, 52000)),
    ).toBeNull();
    expect(
      revisionDeCuotas({ cuotas: 3, total: 52000 }, { cuotas: 6, totalPagado: 52000 }, sinInteres(3, 52000)),
    ).toBe("cuotas_distintas");
  });

  it("1 pago con intención y pedido sin cuotas congeladas: SÍ se revisa", () => {
    expect(
      revisionDeCuotas({ cuotas: null, total: 50000 }, { cuotas: 6, totalPagado: 66070 }, sinInteres(1, 50000)),
    ).toBe("cuotas_distintas");
  });

  it("sin intención (intento anterior o recuperado por el webhook): reglas de antes", () => {
    expect(revisionDeCuotas({ cuotas: 6, total: 1200 }, { cuotas: 6, totalPagado: 1290 }, null)).toBe("monto_distinto");
    expect(revisionDeCuotas({ cuotas: null, total: 1200 }, { cuotas: 12, totalPagado: 2000 }, null)).toBeNull();
  });

  it("datos que el procesador no informó no se acusan", () => {
    expect(revisionDeCuotas({ cuotas: 1, total: 50000 }, {}, conInteres(6, 50000))).toBeNull();
  });
});

describe("motivoNoAcreditable (red de seguridad del cobro aprobado)", () => {
  const pedido = { total: 50000 };

  it("pagó MENOS que el total del pedido: monto_distinto", () => {
    expect(motivoNoAcreditable(pedido, { totalPagado: 49000 })).toBe("monto_distinto");
    expect(motivoNoAcreditable(pedido, { totalPagado: 1 })).toBe("monto_distinto");
    expect(motivoNoAcreditable(pedido, { totalPagado: 0 })).toBe("monto_distinto");
  });

  it("pagó EXACTAMENTE el total: acredita", () => {
    expect(motivoNoAcreditable(pedido, { totalPagado: 50000 })).toBeNull();
    expect(motivoNoAcreditable(pedido, { totalPagado: 50000, cuotas: 1, moneda: "ARS" })).toBeNull();
  });

  it("pagó MÁS (interés de las cuotas del procesador): acredita", () => {
    expect(motivoNoAcreditable(pedido, { totalPagado: 66070, cuotas: 6 })).toBeNull();
  });

  it("tolera el redondeo: un centavo en 1 pago, uno por cuota en cuotas", () => {
    expect(motivoNoAcreditable(pedido, { totalPagado: 49999.99 })).toBeNull();
    expect(motivoNoAcreditable(pedido, { totalPagado: 49999.98 })).toBe("monto_distinto");
    expect(motivoNoAcreditable(pedido, { totalPagado: 49999.94, cuotas: 6 })).toBeNull();
    expect(motivoNoAcreditable(pedido, { totalPagado: 49999.93, cuotas: 6 })).toBe("monto_distinto");
  });

  it("otra moneda que la del pedido no acredita, aunque el número coincida", () => {
    expect(motivoNoAcreditable(pedido, { totalPagado: 50000, moneda: "USD" })).toBe("monto_distinto");
    expect(motivoNoAcreditable(pedido, { totalPagado: 60000, moneda: "BRL" })).toBe("monto_distinto");
    expect(MONEDA_PEDIDO).toBe("ARS");
  });

  it("lo que el procesador no informó no se acusa", () => {
    expect(motivoNoAcreditable(pedido, {})).toBeNull();
    expect(motivoNoAcreditable(pedido, { cuotas: 3 })).toBeNull();
    expect(motivoNoAcreditable(pedido, { totalPagado: Number.NaN })).toBeNull();
  });
});
