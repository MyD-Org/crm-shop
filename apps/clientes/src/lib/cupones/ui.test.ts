import { describe, expect, it } from "vitest";
import type { CuponAplicado } from "./tipos";
import { fmtPrecio } from "../format";
import { avisoCuponGuardado, avisoVencimiento, montosAntesDelCupon, textoCuponNoAplicaEnCambio, textoLineaCupon } from "./ui";

const cupon = (o: Partial<CuponAplicado> = {}): CuponAplicado => ({
  codigo: "LUZ-7KQ2M", codigoId: "c1", promocionId: "p1", nombre: "Bot", pct: 10, pctAplicado: true, envioGratis: false,
  descuento: 2420, subtotalAntes: 20000, condiciones: "", venceEn: null, verificado: true, aviso: null, ...o,
});

describe("textos del cupón en la tienda", () => {
  it("avisoCuponGuardado: el código en mayúsculas, en usted", () => {
    expect(avisoCuponGuardado("luz-7kq2m")).toBe("Cupón LUZ-7KQ2M guardado: se aplica en el checkout.");
  });

  it("textoLineaCupon: código y % si el % se aplicó", () => {
    expect(textoLineaCupon(cupon())).toBe("Cupón LUZ-7KQ2M (10 %)");
    expect(textoLineaCupon(cupon({ pctAplicado: false }))).toBe("Cupón LUZ-7KQ2M");
    expect(textoLineaCupon(cupon({ pct: null, pctAplicado: false }))).toBe("Cupón LUZ-7KQ2M");
  });

  it("avisoVencimiento: sólo si faltan menos de 48 h, en hora de Argentina", () => {
    const venceEn = "2026-11-13T02:59:00.000Z"; // 12/11 23:59 en Argentina
    const ahora = (horasAntes: number) => new Date(new Date(venceEn).getTime() - horasAntes * 3_600_000);
    expect(avisoVencimiento(venceEn, ahora(47))).toBe("Su cupón vence el 12/11 a las 23:59.");
    expect(avisoVencimiento(venceEn, ahora(49))).toBeNull();
    expect(avisoVencimiento(venceEn, ahora(-1))).toBeNull();
    expect(avisoVencimiento(null, ahora(1))).toBeNull();
  });
});

describe("montosAntesDelCupon", () => {
  it("subtotal e impuestos sin el cupón, para que subtotal + impuestos − cupón = total", () => {
    const c = { subtotal: 2300, iva: 483, costoEnvio: 0, total: 2783, cupon: cupon({ descuento: 242, subtotalAntes: 2500 }) };
    expect(montosAntesDelCupon(c)).toEqual({ subtotal: 2500, iva: 525 });
    expect(montosAntesDelCupon({ ...c, cupon: null })).toEqual({ subtotal: 2300, iva: 483 });
  });
});

describe("textoCuponNoAplicaEnCambio", () => {
  it("los dos totales, en usted", () => {
    expect(textoCuponNoAplicaEnCambio("tarjeta de crédito", 900, 1000)).toBe(
      `Con tarjeta de crédito el cupón no aplica: el total pasa de ${fmtPrecio(900)} a ${fmtPrecio(1000)}.`,
    );
  });
});
