import { describe, expect, it } from "vitest";
import { entregaDelCarrito, retiroDeFicha } from "./entrega-eleccion";
import type { EleccionUbicacion } from "./ubicacion";
import type { LocalDisponibilidad } from "./disponibilidad-textos";
import type { DisponibilidadRetiro } from "./sucursales-disponibilidad";

const retiroEn = (slug: string): EleccionUbicacion => ({
  tipo: "retiro",
  sucursal: { slug, nombre: `Local ${slug}`, ciudad: "Ciudad Ejemplo", provincia: "Córdoba" },
});

describe("entregaDelCarrito", () => {
  it("retiro: cotiza como retiro, sin provincia (no hay barra de envío gratis)", () => {
    expect(entregaDelCarrito(retiroEn("sede-a"))).toEqual({ entregaTipo: "retiro", provincia: null, ubicacionConocida: true });
  });

  it("retiro del local único: igual, sin provincia", () => {
    expect(entregaDelCarrito({ tipo: "retiro", sucursal: null })).toEqual({
      entregaTipo: "retiro",
      provincia: null,
      ubicacionConocida: true,
    });
  });

  it("envío a la provincia X: cotiza como envío a X", () => {
    expect(entregaDelCarrito({ tipo: "envio", localidad: "Posadas", provincia: "misiones" })).toEqual({
      entregaTipo: "envio",
      provincia: "misiones",
      ubicacionConocida: true,
    });
  });

  it("envío sin provincia conocida: comportamiento actual (retiro por defecto)", () => {
    expect(entregaDelCarrito({ tipo: "envio", localidad: "Posadas", provincia: null })).toEqual({
      entregaTipo: "retiro",
      provincia: null,
      ubicacionConocida: false,
    });
  });

  it("sin elección: comportamiento actual (retiro por defecto, pide ubicación)", () => {
    expect(entregaDelCarrito({ tipo: "ninguna" })).toEqual({
      entregaTipo: "retiro",
      provincia: null,
      ubicacionConocida: false,
    });
  });
});

describe("retiroDeFicha", () => {
  const local = (slug: string): LocalDisponibilidad => ({ slug, nombre: `Local ${slug}` });
  const locales = [local("sede-a"), local("sede-b"), local("sede-c")];
  const hoy: DisponibilidadRetiro = { estado: "disponible", desde: null, demoraDias: null };
  const no: DisponibilidadRetiro = { estado: "sin_stock", desde: null, demoraDias: null };
  const demora: DisponibilidadRetiro = { estado: "con_demora", desde: "sede-a", demoraDias: 2 };
  const retiro = { "sede-a": no, "sede-b": hoy, "sede-c": demora };

  it("sin local elegido: todos por conveniencia y sin elegido", () => {
    const r = retiroDeFicha(locales, retiro, null);
    expect(r.elegido).toBeNull();
    expect(r.otros.map((l) => l.slug)).toEqual(["sede-b", "sede-c", "sede-a"]);
  });

  it("con local elegido: queda aparte (aunque no tenga stock) y los demás siguen visibles", () => {
    const r = retiroDeFicha(locales, retiro, "sede-a");
    expect(r.elegido?.slug).toBe("sede-a");
    expect(r.otros.map((l) => l.slug)).toEqual(["sede-b", "sede-c"]);
  });

  it("local elegido que no figura en la disponibilidad: se ignora", () => {
    const r = retiroDeFicha(locales, { "sede-b": hoy }, "sede-a");
    expect(r.elegido).toBeNull();
    expect(r.otros.map((l) => l.slug)).toEqual(["sede-b"]);
  });
});
