import { describe, expect, it } from "vitest";
import {
  PIE_A_COORDINAR,
  PIE_GENERICO,
  PIE_MERCADOPAGO,
  mediosParaModalidad,
  pagoValidoConMedios,
  pieDelMedio,
  slugsPagoEnLinea,
  type MedioPago,
} from "./medios-pago";

const medio = (slug: string, cobroOnline = false): MedioPago => ({
  slug,
  nombre: slug,
  instrucciones: "",
  activo: true,
  aplicaRetiro: true,
  aplicaEnvio: true,
  cobroOnline,
  orden: 0,
  idListaPrecios: null,
  destacarEnCatalogo: false,
  mostrarEnFicha: false,
});

const MEDIOS = [medio("transferencia"), medio("mercadopago", true)];

describe("disponibilidad por procesador", () => {
  it("procesadorDisponible oculta el medio cuyo procesador no está disponible", () => {
    const r = mediosParaModalidad(MEDIOS, "retiro", { procesadorDisponible: () => false });
    expect(r.map((m) => m.slug)).toEqual(["transferencia"]);
  });

  it("recibe el id del procesador del medio, no el slug", () => {
    const vistos: string[] = [];
    mediosParaModalidad(MEDIOS, "retiro", {
      procesadorDisponible: (p) => {
        vistos.push(p);
        return true;
      },
    });
    expect(vistos).toEqual(["mercadopago"]);
  });

  it("los medios manuales no dependen de ningún procesador", () => {
    const r = mediosParaModalidad([medio("transferencia")], "retiro", { procesadorDisponible: () => false });
    expect(r).toHaveLength(1);
  });

  it("procesadorDisponible manda sobre el atajo heredado mpDisponible", () => {
    const r = mediosParaModalidad(MEDIOS, "retiro", { mpDisponible: false, procesadorDisponible: () => true });
    expect(r.map((m) => m.slug)).toContain("mercadopago");
  });

  it("pagoValidoConMedios rechaza el medio de un procesador sin credenciales", () => {
    expect(pagoValidoConMedios(MEDIOS, "retiro", "mercadopago", { procesadorDisponible: () => false })).toBe(false);
    expect(pagoValidoConMedios(MEDIOS, "retiro", "mercadopago", { procesadorDisponible: () => true })).toBe(true);
  });
});

describe("pie del medio y slugs en línea", () => {
  it("pieDelMedio: en línea por procesador, manual genérico, sin medio a coordinar", () => {
    expect(pieDelMedio(medio("mercadopago", true))).toBe(PIE_MERCADOPAGO);
    expect(pieDelMedio(medio("transferencia"))).toBe(PIE_GENERICO);
    expect(pieDelMedio(null)).toBe(PIE_A_COORDINAR);
  });

  it("slugsPagoEnLinea lista los medios con procesador", () => {
    expect(slugsPagoEnLinea()).toEqual(["mercadopago", "payway"]);
  });
});
