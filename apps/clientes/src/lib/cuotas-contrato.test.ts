import { describe, expect, it } from "vitest";
// Fixtures del contrato v2 (espejo de MyD-Org/platform contracts/cuotas/v2).
// Si el contrato cambia, re-copiar en el mismo PR.
import cuotasMaxFueraDeRango from "./__fixtures__/cuotas-contrato-v2/invalido-cuotas-max-fuera-de-rango.json";
import cuotasMaxString from "./__fixtures__/cuotas-contrato-v2/invalido-cuotas-max-string.json";
import escalonesNoArray from "./__fixtures__/cuotas-contrato-v2/invalido-escalones-no-array.json";
import montoMinimoNegativo from "./__fixtures__/cuotas-contrato-v2/invalido-monto-minimo-negativo.json";
import proveedorSinNombre from "./__fixtures__/cuotas-contrato-v2/invalido-proveedor-sin-nombre.json";
import sinProveedores from "./__fixtures__/cuotas-contrato-v2/invalido-sin-proveedores.json";
import versionV1 from "./__fixtures__/cuotas-contrato-v2/invalido-version-v1.json";
import vacioValido from "./__fixtures__/cuotas-contrato-v2/vacio-valido.json";
import valido from "./__fixtures__/cuotas-contrato-v2/valido.json";
import { ContratoInvalidoError, parsearContratoCuotasV2 } from "./cuotas-contrato";

const clon = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("parsearContratoCuotasV2", () => {
  it("fixture válido → objeto tipado igual al payload", () => {
    expect(parsearContratoCuotasV2(valido)).toEqual(valido);
  });

  it("vacío válido (sin proveedores) → se acepta", () => {
    expect(parsearContratoCuotasV2(vacioValido)).toEqual(vacioValido);
  });

  it.each([
    ["version-v1", versionV1],
    ["cuotas-max-fuera-de-rango", cuotasMaxFueraDeRango],
    ["cuotas-max-string", cuotasMaxString],
    ["monto-minimo-negativo", montoMinimoNegativo],
    ["escalones-no-array", escalonesNoArray],
    ["proveedor-sin-nombre", proveedorSinNombre],
    ["sin-proveedores", sinProveedores],
  ])("fixture inválido %s → ContratoInvalidoError", (_n, payload) => {
    expect(() => parsearContratoCuotasV2(payload)).toThrow(ContratoInvalidoError);
  });

  it.each([
    ["no es objeto", () => "hola"],
    ["null", () => null],
    ["array", () => []],
    ["falta actualizadoEn", (p: Record<string, unknown>) => { const c = { ...p }; delete c.actualizadoEn; return c; }],
    ["actualizadoEn no es fecha", (p: Record<string, unknown>) => ({ ...p, actualizadoEn: "ayer" })],
    ["tenant vacío", (p: Record<string, unknown>) => ({ ...p, tenant: "" })],
    ["proveedores no es array", (p: Record<string, unknown>) => ({ ...p, proveedores: {} })],
  ])("raíz: %s → error", (_n, mutar) => {
    expect(() => parsearContratoCuotasV2(mutar(clon(valido)))).toThrow(ContratoInvalidoError);
  });

  it.each([
    ["cuotasMax 0", { cuotasMax: 0 }],
    ["cuotasMax 2.5", { cuotasMax: 2.5 }],
    ["montoMinimo string", { montoMinimo: "100" }],
    ["montoMinimo faltante", { montoMinimo: undefined }],
    ["id vacío", { id: "" }],
  ])("escalón: %s → error", (_n, parche) => {
    const p = clon(valido);
    p.proveedores[0].escalones[0] = { ...p.proveedores[0].escalones[0], ...parche } as never;
    expect(() => parsearContratoCuotasV2(p)).toThrow(ContratoInvalidoError);
  });

  it.each([
    ["orden no entero", { orden: 1.5 }],
    ["proveedor vacío", { proveedor: "" }],
    ["activo string", { activo: "si" }],
  ])("proveedor: %s → error", (_n, parche) => {
    const p = clon(valido);
    p.proveedores[0] = { ...p.proveedores[0], ...parche } as never;
    expect(() => parsearContratoCuotasV2(p)).toThrow(ContratoInvalidoError);
  });

  it("acepta cuotasMax 1 y 24 (bordes)", () => {
    const p = clon(valido);
    p.proveedores[0].escalones[0].cuotasMax = 1;
    p.proveedores[0].escalones[2].cuotasMax = 24;
    expect(() => parsearContratoCuotasV2(p)).not.toThrow();
  });

  it("el mensaje dice qué campo falló", () => {
    const p = clon(valido);
    (p.proveedores[0].escalones[1] as Record<string, unknown>).cuotasMax = 30;
    expect(() => parsearContratoCuotasV2(p)).toThrow(/proveedores\[0\]\.escalones\[1\]\.cuotasMax/);
  });

  it("escalones desordenados se devuelven por monto mínimo ascendente", () => {
    const p = clon(valido);
    p.proveedores[0].escalones.reverse();
    expect(parsearContratoCuotasV2(p).proveedores[0].escalones.map((e) => e.montoMinimo)).toEqual([0, 180000, 450000.5]);
  });

  it("campos extra se descartan (la salida sólo trae los del contrato)", () => {
    const p = clon(valido) as unknown as Record<string, unknown> & {
      proveedores: (Record<string, unknown> & { escalones: Record<string, unknown>[] })[];
    };
    p.extra = 1;
    p.proveedores[0].color = "azul";
    p.proveedores[0].escalones[0].sinInteres = true;
    const r = parsearContratoCuotasV2(p);
    expect(r).not.toHaveProperty("extra");
    expect(r.proveedores[0]).not.toHaveProperty("color");
    expect(r.proveedores[0].escalones[0]).not.toHaveProperty("sinInteres");
  });
});
