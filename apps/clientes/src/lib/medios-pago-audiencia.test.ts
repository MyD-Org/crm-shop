import { describe, expect, it } from "vitest";
import { medioElegido, mediosParaModalidad, pagoValidoConMedios, type MedioPago } from "./medios-pago";
import { seleccionarMediosPrecio } from "./medios-precio";

const medio = (o: Partial<MedioPago> & { slug: string }): MedioPago => ({
  nombre: o.slug,
  instrucciones: "",
  activo: true,
  aplicaRetiro: true,
  aplicaEnvio: true,
  cobroOnline: false,
  orden: 0,
  idListaPrecios: null,
  destacarEnCatalogo: false,
  mostrarEnFicha: false,
  ...o,
});

const PUBLICOS: MedioPago[] = [
  medio({ slug: "transferencia", orden: 2 }),
  medio({ slug: "efectivo", orden: 1 }),
  medio({ slug: "mercadopago", cobroOnline: true, orden: 0 }),
];
const CC = medio({ slug: "efectivo-cheque", nombre: "Efectivo o cheque", orden: 5, audiencia: "cuenta_corriente" });
const TODOS = [...PUBLICOS, CC];

describe("audiencia 'cuenta_corriente' (medio solo para cuentas corrientes)", () => {
  it("el público nunca lo ve: ni retiro ni envío", () => {
    for (const e of ["retiro", "envio"] as const) {
      expect(mediosParaModalidad(TODOS, e).map((m) => m.slug)).not.toContain("efectivo-cheque");
    }
  });

  it("el público no puede pagar con su slug (validación de servidor)", () => {
    for (const e of ["retiro", "envio"] as const) {
      expect(pagoValidoConMedios(TODOS, e, "efectivo-cheque")).toBe(false);
    }
    expect(pagoValidoConMedios(TODOS, "retiro", "transferencia")).toBe(true);
  });

  it("si el único medio que aplica es el de cuenta corriente, el público cae a a_coordinar", () => {
    expect(pagoValidoConMedios([CC], "retiro", "efectivo-cheque")).toBe(false);
    expect(pagoValidoConMedios([CC], "retiro", "a_coordinar")).toBe(true);
    expect(medioElegido([CC], "retiro", "efectivo-cheque")).toBeNull();
  });

  it("un medio sin el campo (filas viejas) se trata como público", () => {
    expect(mediosParaModalidad(PUBLICOS, "retiro")).toHaveLength(3);
  });

  it("con esCuentaCorriente solo se ofrece y se acepta ese medio (activo)", () => {
    expect(mediosParaModalidad(TODOS, "retiro", { esCuentaCorriente: true }).map((m) => m.slug)).toEqual([
      "efectivo-cheque",
    ]);
    expect(pagoValidoConMedios(TODOS, "retiro", "efectivo-cheque", { esCuentaCorriente: true })).toBe(true);
    expect(pagoValidoConMedios(TODOS, "retiro", "mercadopago", { esCuentaCorriente: true })).toBe(false);
  });

  it("con esCuentaCorriente y el medio inactivo, el pedido queda a coordinar", () => {
    const inactivo = [...PUBLICOS, { ...CC, activo: false }];
    expect(mediosParaModalidad(inactivo, "retiro", { esCuentaCorriente: true })).toEqual([]);
    expect(pagoValidoConMedios(inactivo, "retiro", "a_coordinar", { esCuentaCorriente: true })).toBe(true);
    expect(pagoValidoConMedios(inactivo, "retiro", "transferencia", { esCuentaCorriente: true })).toBe(false);
  });
});

describe("el medio de cuenta corriente no entra en 'con medio' ni en cuotas", () => {
  it("ni destacado, ni ficha, ni medio de cuotas", () => {
    const cc = medio({
      slug: "cc",
      audiencia: "cuenta_corriente",
      idListaPrecios: "L1",
      destacarEnCatalogo: true,
      mostrarEnFicha: true,
      cobroOnline: true,
      condicionesCuotas: [{ cuotas: 3, idListaPrecios: "L3", montoMinimo: null }],
    });
    const aa = medio({ slug: "aa", idListaPrecios: "L1", mostrarEnFicha: true });
    const r = seleccionarMediosPrecio([cc, aa], false, true);
    expect(r.destacado).toBeNull();
    expect(r.ficha.map((m) => m.slug)).toEqual(["aa"]);
    expect(r.cuotas).toBeUndefined();
  });
});
