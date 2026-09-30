import { describe, expect, it } from "vitest";
import { contextoDisponibilidad } from "./disponibilidad-contexto";
import type { SucursalDato } from "./sucursales";

const s = (
  slug: string,
  orden: number,
  extra: Partial<SucursalDato> = {},
): SucursalDato => ({
  slug,
  aceptaRetiro: true,
  aceptaEnvio: true,
  envioCiudades: [],
  orden,
  activa: true,
  predeterminada: false,
  ...extra,
});
const sucursales = [
  s("sede-b", 1, { predeterminada: true }),
  s("sede-a", 0),
  s("sede-c", 2, { activa: false }),
];

describe("contextoDisponibilidad", () => {
  it("envío: cuenta el stock de todas las activas, por orden", () => {
    const c = contextoDisponibilidad({ zona: "sede-b", sucursales });
    expect(c).toEqual({
      zona: "sede-b",
      activas: ["sede-a", "sede-b"],
      contarEn: ["sede-a", "sede-b"],
      stockHeredado: "sede-a",
    });
  });
  it("envío sin respaldo: sólo la sucursal de la zona", () => {
    const c = contextoDisponibilidad({
      zona: "sede-b",
      sucursales,
      reglas: { trasladoDias: 7, respaldoEnvio: false },
    });
    expect(c?.contarEn).toEqual(["sede-b"]);
  });
  it("retiro: sólo el local elegido", () => {
    const c = contextoDisponibilidad({
      zona: "sede-b",
      sucursales,
      modalidad: "retiro",
      local: "sede-a",
    });
    expect(c?.contarEn).toEqual(["sede-a"]);
    expect(c?.local).toBe("sede-a");
  });
  it("retiro sin local válido cuenta como el envío", () => {
    const c = contextoDisponibilidad({
      zona: "sede-b",
      sucursales,
      modalidad: "retiro",
      local: "sede-c",
    });
    expect(c?.contarEn).toEqual(["sede-a", "sede-b"]);
    expect(c?.local).toBeUndefined();
  });
  it("zona desconocida o inactiva cae en la predeterminada", () => {
    expect(contextoDisponibilidad({ zona: "sede-c", sucursales })?.zona).toBe(
      "sede-b",
    );
    expect(contextoDisponibilidad({ zona: null, sucursales })?.zona).toBe(
      "sede-b",
    );
  });
  it("sin sucursales activas no hay contexto", () => {
    expect(
      contextoDisponibilidad({
        zona: "x",
        sucursales: [s("sede-c", 0, { activa: false })],
      }),
    ).toBeNull();
    expect(contextoDisponibilidad({ zona: "x", sucursales: [] })).toBeNull();
  });
});
