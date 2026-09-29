import { afterEach, describe, expect, it, vi } from "vitest";
import { decidirSucursalDePedido, SucursalPedidoError } from "./sucursales-pedido";
import type { DatosSucursales, SucursalVista } from "./sucursales-repo";

const suc = (slug: string, extra: Partial<SucursalVista> = {}): SucursalVista => ({
  slug,
  nombre: slug,
  ciudad: "Ciudad Ejemplo",
  provincia: "Provincia Ejemplo",
  aceptaRetiro: true,
  aceptaEnvio: true,
  envioCiudades: [],
  orden: 1,
  activa: true,
  predeterminada: false,
  ...extra,
});

const datos: DatosSucursales = {
  sucursales: [suc("sede-a", { envioCiudades: ["Puerto Iguazú"] }), suc("sede-b", { orden: 2, predeterminada: true })],
  zonas: [{ id: "z1", provinciaClave: "misiones", sucursal: "sede-a", facturaSucursal: null }],
};

afterEach(() => vi.restoreAllMocks());

describe("decidirSucursalDePedido", () => {
  it("envío a Misiones: sede-a con la regla congelada", () => {
    const r = decidirSucursalDePedido(
      { entregaTipo: "envio", provincia: "misiones", ciudad: "Puerto Iguazú" },
      datos,
    );
    expect(r?.sucursal).toBe("sede-a");
    expect(r?.regla).toMatchObject({ v: 1, regla: "zona:misiones", motivo: "zona", zonaId: "z1" });
  });

  it("provincia sin zona: la predeterminada", () => {
    const r = decidirSucursalDePedido({ entregaTipo: "envio", provincia: "cordoba", ciudad: "Córdoba" }, datos);
    expect(r?.sucursal).toBe("sede-b");
    expect(r?.regla.regla).toBe("zona:default");
  });

  it("envío a una ciudad fuera de la lista de la sucursal: error sin_envio", () => {
    expect(() =>
      decidirSucursalDePedido({ entregaTipo: "envio", provincia: "misiones", ciudad: "Posadas" }, datos),
    ).toThrow(SucursalPedidoError);
  });

  it("retiro en un local elegido: ignora la zona", () => {
    const r = decidirSucursalDePedido(
      { entregaTipo: "retiro", provincia: "misiones", sucursalRetiro: "sede-b" },
      datos,
    );
    expect(r?.sucursal).toBe("sede-b");
    expect(r?.regla.regla).toBe("retiro:sede-b");
  });

  it("retiro en un local que no admite retiro: error sin_retiro", () => {
    const sinRetiro: DatosSucursales = {
      ...datos,
      sucursales: [suc("sede-a", { aceptaRetiro: false }), suc("sede-b", { orden: 2, predeterminada: true })],
    };
    try {
      decidirSucursalDePedido({ entregaTipo: "retiro", sucursalRetiro: "sede-a" }, sinRetiro);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SucursalPedidoError);
      expect((e as SucursalPedidoError).codigo).toBe("sin_retiro");
    }
  });

  it("retiro sin local elegido: la sucursal de la zona si admite retiro, si no la predeterminada", () => {
    expect(decidirSucursalDePedido({ entregaTipo: "retiro", provincia: "misiones" }, datos)?.sucursal).toBe("sede-a");
    const zonaSinRetiro: DatosSucursales = {
      ...datos,
      sucursales: [suc("sede-a", { aceptaRetiro: false }), suc("sede-b", { orden: 2, predeterminada: true })],
    };
    expect(
      decidirSucursalDePedido({ entregaTipo: "retiro", provincia: "misiones" }, zonaSinRetiro)?.sucursal,
    ).toBe("sede-b");
  });

  it("sin sucursales cargadas: null y no falla", () => {
    expect(decidirSucursalDePedido({ entregaTipo: "envio", provincia: "misiones" }, { sucursales: [], zonas: [] })).toBeNull();
    expect(decidirSucursalDePedido({ entregaTipo: "retiro" }, { sucursales: [], zonas: [] })).toBeNull();
  });

  it("todas inactivas: null (avisa en el log), no frena la venta", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const inactivas: DatosSucursales = {
      ...datos,
      sucursales: datos.sucursales.map((s) => ({ ...s, activa: false })),
    };
    expect(decidirSucursalDePedido({ entregaTipo: "envio", provincia: "misiones", ciudad: "Puerto Iguazú" }, inactivas)).toBeNull();
    expect(log).toHaveBeenCalled();
  });

  it("es determinista", () => {
    const e = { entregaTipo: "envio" as const, provincia: "misiones", ciudad: "Puerto Iguazú" };
    expect(decidirSucursalDePedido(e, datos)).toEqual(decidirSucursalDePedido(e, datos));
  });
});
