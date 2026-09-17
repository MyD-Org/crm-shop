import { describe, expect, it } from "vitest";
// Copias de MyD-Org/platform contracts/cuotas/v1/fixtures (commit 496cf79).
// Si el contrato cambia, re-copiar en el mismo PR.
import invalido from "./__fixtures__/cuotas-contrato-v1/invalido.json";
import vacioValido from "./__fixtures__/cuotas-contrato-v1/vacio-valido.json";
import valido from "./__fixtures__/cuotas-contrato-v1/valido.json";
import { ContratoInvalidoError, parsearContratoCuotasV1 } from "./cuotas-contrato";

const clon = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("parsearContratoCuotasV1", () => {
  it("fixture válido → objeto tipado igual al payload", () => {
    expect(parsearContratoCuotasV1(valido)).toEqual(valido);
  });

  it("vacío válido (sin medios ni opciones) → se acepta", () => {
    expect(parsearContratoCuotasV1(vacioValido)).toEqual(vacioValido);
  });

  it("fixture inválido → tira ContratoInvalidoError", () => {
    expect(() => parsearContratoCuotasV1(invalido)).toThrow(ContratoInvalidoError);
  });

  it.each([
    ["no es objeto", () => "hola"],
    ["null", () => null],
    ["version distinta", (p: Record<string, unknown>) => ({ ...p, version: "v2" })],
    ["falta actualizadoEn", (p: Record<string, unknown>) => { const c = { ...p }; delete c.actualizadoEn; return c; }],
    ["actualizadoEn no es fecha", (p: Record<string, unknown>) => ({ ...p, actualizadoEn: "ayer" })],
    ["tenant vacío", (p: Record<string, unknown>) => ({ ...p, tenant: "" })],
    ["medios no es array", (p: Record<string, unknown>) => ({ ...p, medios: {} })],
  ])("raíz: %s → error", (_n, mutar) => {
    expect(() => parsearContratoCuotasV1(mutar(clon(valido)))).toThrow(ContratoInvalidoError);
  });

  it.each([
    ["cuotas string", { cuotas: "6" }],
    ["cuotas 1", { cuotas: 1 }],
    ["cuotas 25", { cuotas: 25 }],
    ["cuotas 2.5", { cuotas: 2.5 }],
    ["montoMinimo negativo", { montoMinimo: -1 }],
    ["montoMinimo NaN-ish", { montoMinimo: "100" }],
    ["sinInteres no booleano", { sinInteres: "true" }],
    ["vigenteDesde DD/MM/YYYY", { vigenteDesde: "30/09/2026" }],
    ["vigenteHasta mes 13", { vigenteHasta: "2026-13-01" }],
    ["vigenteHasta undefined (falta)", { vigenteHasta: undefined }],
    ["medioId vacío", { medioId: "" }],
    ["activo faltante", { activo: undefined }],
  ])("opción: %s → error", (_n, parche) => {
    const p = clon(valido);
    p.opciones[0] = { ...p.opciones[0], ...parche } as (typeof p.opciones)[number];
    expect(() => parsearContratoCuotasV1(p)).toThrow(ContratoInvalidoError);
  });

  it.each([
    ["orden no entero", { orden: 1.5 }],
    ["codigo vacío", { codigo: "" }],
    ["activo string", { activo: "si" }],
  ])("medio: %s → error", (_n, parche) => {
    const p = clon(valido);
    p.medios[0] = { ...p.medios[0], ...parche } as (typeof p.medios)[number];
    expect(() => parsearContratoCuotasV1(p)).toThrow(ContratoInvalidoError);
  });

  it("el mensaje dice qué campo falló", () => {
    const p = clon(valido);
    (p.opciones[1] as Record<string, unknown>).vigenteDesde = "2026/09/01";
    expect(() => parsearContratoCuotasV1(p)).toThrow(/opciones\[1\]\.vigenteDesde/);
  });

  it("campos extra se descartan (la salida sólo trae los del contrato)", () => {
    const p = clon(valido) as unknown as Record<string, unknown> & { medios: Record<string, unknown>[] };
    p.extra = 1;
    p.medios[0].color = "azul";
    const r = parsearContratoCuotasV1(p);
    expect(r).not.toHaveProperty("extra");
    expect(r.medios[0]).not.toHaveProperty("color");
  });
});
