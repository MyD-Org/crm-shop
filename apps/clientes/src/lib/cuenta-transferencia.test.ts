import { describe, expect, it } from "vitest";
import type { CuentaBancaria } from "./cuentas-bancarias";
import type { DatosSucursales } from "./sucursales-repo";
import { cuentaParaVistaPrevia } from "./cuenta-transferencia";

const cuenta = (p: Partial<CuentaBancaria> & { id: string }): CuentaBancaria => ({
  alias: `alias.${p.id}`,
  cbu: "0000000000000000000000",
  banco: "Banco Ejemplo",
  titular: "Titular Ejemplo SA",
  cuit: "30000000000",
  todasLasSucursales: true,
  sucursalSlugs: [],
  montoMin: null,
  montoMax: null,
  activa: true,
  predeterminada: false,
  orden: 0,
  ...p,
});

const suc = (slug: string, orden: number, extra: Record<string, unknown> = {}) => ({
  slug,
  nombre: slug,
  ciudad: "x",
  provincia: "x",
  direccion: "x",
  horario: "x",
  aceptaRetiro: true,
  aceptaEnvio: true,
  envioCiudades: [],
  orden,
  activa: true,
  predeterminada: false,
  ...extra,
});

const datos = {
  sucursales: [suc("igz", 1), suc("mdp", 2, { predeterminada: true })],
  zonas: [{ id: "z1", provinciaClave: "misiones", sucursal: "igz", facturaSucursal: null }],
} as unknown as DatosSucursales;

const cuentas = [
  cuenta({ id: "I", orden: 1, todasLasSucursales: false, sucursalSlugs: ["igz"] }),
  cuenta({ id: "M", orden: 2, todasLasSucursales: false, sucursalSlugs: ["mdp"] }),
];

describe("cuentaParaVistaPrevia", () => {
  it("retiro: usa el local elegido", () => {
    const s = cuentaParaVistaPrevia({
      cuentas,
      datos,
      entrada: { entregaTipo: "retiro", sucursalRetiro: "mdp" },
      total: 100,
      sucursalesActivas: true,
    });
    expect(s).toMatchObject({ cuentaId: "M", sucursal: "mdp", totalEvaluado: 100 });
  });

  it("envío: usa la sucursal de la zona de la provincia", () => {
    const s = cuentaParaVistaPrevia({
      cuentas,
      datos,
      entrada: { entregaTipo: "envio", provincia: "misiones" },
      total: 100,
      sucursalesActivas: true,
    });
    expect(s).toMatchObject({ cuentaId: "I", sucursal: "igz" });
  });

  it("flag de sucursales apagado: sucursal null (sólo cuentas de 'todas')", () => {
    const todas = [...cuentas, cuenta({ id: "T", orden: 9 })];
    const s = cuentaParaVistaPrevia({
      cuentas: todas,
      datos,
      entrada: { entregaTipo: "retiro", sucursalRetiro: "mdp" },
      total: 100,
      sucursalesActivas: false,
    });
    expect(s).toMatchObject({ cuentaId: "T", sucursal: null });
  });

  it("local de retiro que no admite retiro: no tira, sucursal null", () => {
    const sinRetiro = {
      ...datos,
      sucursales: [suc("igz", 1, { aceptaRetiro: false }), suc("mdp", 2, { aceptaRetiro: false })],
    } as unknown as DatosSucursales;
    const todas = [...cuentas, cuenta({ id: "T", orden: 9 })];
    const s = cuentaParaVistaPrevia({
      cuentas: todas,
      datos: sinRetiro,
      entrada: { entregaTipo: "retiro", sucursalRetiro: "igz" },
      total: 100,
      sucursalesActivas: true,
    });
    expect(s).toMatchObject({ cuentaId: "T", sucursal: null });
  });

  it("sin cuentas aplicables devuelve null", () => {
    expect(
      cuentaParaVistaPrevia({
        cuentas: [],
        datos,
        entrada: { entregaTipo: "retiro", sucursalRetiro: "mdp" },
        total: 100,
        sucursalesActivas: true,
      }),
    ).toBeNull();
  });

  it("evalúa el rango con el total", () => {
    const rango = [cuenta({ id: "CH", orden: 1, montoMax: 50 }), cuenta({ id: "GR", orden: 2, montoMin: 50.01 })];
    const s = cuentaParaVistaPrevia({
      cuentas: rango,
      datos,
      entrada: { entregaTipo: "retiro", sucursalRetiro: "mdp" },
      total: 1210,
      sucursalesActivas: true,
    });
    expect(s?.cuentaId).toBe("GR");
  });
});
