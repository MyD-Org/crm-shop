import { describe, expect, it } from "vitest";
import {
  SLUG_TRANSFERENCIA,
  armarSnapshotCuenta,
  resolverCuenta,
  type CuentaBancaria,
} from "./cuentas-bancarias";

function cuenta(p: Partial<CuentaBancaria> & { id: string }): CuentaBancaria {
  return {
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
  };
}

const idDe = (r: ReturnType<typeof resolverCuenta>) => r?.cuenta.id ?? null;

describe("resolverCuenta", () => {
  it("sin cuentas devuelve null", () => {
    expect(resolverCuenta([], { sucursal: "igz", total: 100 })).toBeNull();
  });

  it("gana la de menor orden", () => {
    const r = resolverCuenta([cuenta({ id: "A", orden: 2 }), cuenta({ id: "B", orden: 1 })], {
      sucursal: "igz",
      total: 100,
    });
    expect(idDe(r)).toBe("B");
    expect(r?.motivo).toBe("regla");
  });

  it("desempata de forma estable por alias y luego por id", () => {
    const a = cuenta({ id: "2", alias: "zeta" });
    const b = cuenta({ id: "1", alias: "alfa" });
    expect(idDe(resolverCuenta([a, b], { sucursal: null, total: 1 }))).toBe("1");
    expect(idDe(resolverCuenta([b, a], { sucursal: null, total: 1 }))).toBe("1");
    const c = cuenta({ id: "9", alias: "igual" });
    const d = cuenta({ id: "3", alias: "igual" });
    expect(idDe(resolverCuenta([c, d], { sucursal: null, total: 1 }))).toBe("3");
  });

  it("extremos inclusivos en centavos enteros", () => {
    const c = cuenta({ id: "A", montoMin: 1000, montoMax: 2000 });
    expect(idDe(resolverCuenta([c], { sucursal: null, total: 1000 }))).toBe("A");
    expect(idDe(resolverCuenta([c], { sucursal: null, total: 2000 }))).toBe("A");
    expect(resolverCuenta([c], { sucursal: null, total: 2000.01 })).toBeNull();
    expect(resolverCuenta([c], { sucursal: null, total: 999.99 })).toBeNull();
    // 0.1 + 0.2 no debe romper el borde
    const d = cuenta({ id: "D", montoMax: 0.3 });
    expect(idDe(resolverCuenta([d], { sucursal: null, total: 0.1 + 0.2 }))).toBe("D");
  });

  it("límites nulos son sin límite", () => {
    const soloMin = cuenta({ id: "A", montoMin: 100000 });
    const soloMax = cuenta({ id: "B", montoMax: 500 });
    expect(idDe(resolverCuenta([soloMin], { sucursal: null, total: 9e9 }))).toBe("A");
    expect(resolverCuenta([soloMin], { sucursal: null, total: 5 })).toBeNull();
    expect(idDe(resolverCuenta([soloMax], { sucursal: null, total: 0 }))).toBe("B");
  });

  it("todas=true aplica con sucursal null (flag apagado) y con cualquier sucursal", () => {
    const c = cuenta({ id: "A", todasLasSucursales: true });
    expect(idDe(resolverCuenta([c], { sucursal: null, total: 1 }))).toBe("A");
    expect(idDe(resolverCuenta([c], { sucursal: "igz", total: 1 }))).toBe("A");
  });

  it("lista: incluida aplica, excluida no; sucursal ausente solo matchea todas=true", () => {
    const c = cuenta({ id: "A", todasLasSucursales: false, sucursalSlugs: ["mdp"] });
    expect(idDe(resolverCuenta([c], { sucursal: "mdp", total: 1 }))).toBe("A");
    expect(resolverCuenta([c], { sucursal: "igz", total: 1 })).toBeNull();
    expect(resolverCuenta([c], { sucursal: null, total: 1 })).toBeNull();
  });

  it("ignora inactivas", () => {
    expect(resolverCuenta([cuenta({ id: "A", activa: false })], { sucursal: null, total: 1 })).toBeNull();
  });

  it("la predeterminada compite por orden si cumple sus reglas", () => {
    const pred = cuenta({ id: "P", predeterminada: true, orden: 1 });
    const otra = cuenta({ id: "O", orden: 2 });
    const r = resolverCuenta([otra, pred], { sucursal: "igz", total: 1 });
    expect(idDe(r)).toBe("P");
    expect(r?.motivo).toBe("regla");
  });

  it("cae a la predeterminada activa si ninguna cumple", () => {
    const pred = cuenta({
      id: "P",
      predeterminada: true,
      todasLasSucursales: false,
      sucursalSlugs: ["mdp"],
      montoMax: 10,
    });
    const otra = cuenta({ id: "O", todasLasSucursales: false, sucursalSlugs: ["mdp"] });
    const r = resolverCuenta([otra, pred], { sucursal: "igz", total: 5000 });
    expect(idDe(r)).toBe("P");
    expect(r?.motivo).toBe("predeterminada");
  });

  it("predeterminada inactiva no sirve de respaldo", () => {
    const pred = cuenta({ id: "P", predeterminada: true, activa: false });
    const otra = cuenta({ id: "O", todasLasSucursales: false, sucursalSlugs: ["mdp"] });
    expect(resolverCuenta([otra, pred], { sucursal: "igz", total: 1 })).toBeNull();
  });
});

describe("armarSnapshotCuenta", () => {
  it("congela los datos bancarios y el contexto de la resolución", () => {
    const c = cuenta({ id: "A", alias: "mi.alias", cbu: "1234567890123456789012", cuit: "30111111112" });
    const s = armarSnapshotCuenta(
      { cuenta: c, motivo: "regla" },
      { sucursal: "mdp", total: 1500.5 },
      new Date("2026-10-01T12:00:00.000Z"),
    );
    expect(s).toEqual({
      v: 1,
      cuentaId: "A",
      alias: "mi.alias",
      cbu: "1234567890123456789012",
      banco: "Banco Ejemplo",
      titular: "Titular Ejemplo SA",
      cuit: "30111111112",
      motivo: "regla",
      sucursal: "mdp",
      totalEvaluado: 1500.5,
      congeladaEn: "2026-10-01T12:00:00.000Z",
    });
  });

  it("expone el slug fijo", () => {
    expect(SLUG_TRANSFERENCIA).toBe("transferencia");
  });
});
