import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let filas: { slug: string; activa: boolean; predeterminada: boolean }[] = [];
const lecturas = vi.fn();
vi.mock("@/lib/tenant", () => ({ shopTenantId: () => "tenant-ejemplo" }));
vi.mock("@/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => {
          lecturas();
          return filas;
        },
      }),
    }),
  }),
}));

import {
  MEMO_CUENTAS_MS,
  cuentaParaCobrar,
  cuentaPrevistaDelPedido,
  datosCuentas,
  leerDatosCuentas,
  limpiarMemoCuentas,
  proveedorDeIntento,
} from "./cuentas-sucursales";

beforeEach(() => {
  limpiarMemoCuentas();
  filas = [
    { slug: "mdp", activa: true, predeterminada: false },
    { slug: "igz", activa: true, predeterminada: true },
  ];
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  lecturas.mockClear();
});

describe("leerDatosCuentas", () => {
  it("predeterminada y slugs (predeterminada primero, luego por slug)", async () => {
    filas.push({ slug: "alfa", activa: false, predeterminada: false });
    expect(await leerDatosCuentas()).toEqual({ predeterminada: "igz", slugs: ["igz", "alfa", "mdp"] });
  });

  it("sin predeterminada: null", async () => {
    filas = [{ slug: "mdp", activa: true, predeterminada: false }];
    expect((await leerDatosCuentas()).predeterminada).toBeNull();
  });

  it("loguea si dos slugs comparten el sufijo de variables", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    filas = [
      { slug: "mar-del-plata", activa: true, predeterminada: false },
      { slug: "MAR-DEL-PLATA", activa: true, predeterminada: false },
    ];
    await leerDatosCuentas();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("_MAR_DEL_PLATA");
  });
});

describe("datosCuentas (memo de 60 s por instancia)", () => {
  it("lee una vez dentro de la ventana y vuelve a leer al vencer", async () => {
    const t0 = 1_000_000;
    await datosCuentas(t0);
    await datosCuentas(t0 + MEMO_CUENTAS_MS - 1);
    expect(lecturas).toHaveBeenCalledTimes(1);
    filas = [{ slug: "mdp", activa: true, predeterminada: true }];
    expect((await datosCuentas(t0 + MEMO_CUENTAS_MS)).predeterminada).toBe("mdp");
    expect(lecturas).toHaveBeenCalledTimes(2);
  });
});

describe("cuentaPrevistaDelPedido", () => {
  it("facturaSucursal ?? sucursal ?? predeterminada", async () => {
    expect(await cuentaPrevistaDelPedido({ sucursal: "igz", facturaSucursal: "mdp" })).toBe("mdp");
    expect(await cuentaPrevistaDelPedido({ sucursal: "mdp", facturaSucursal: null })).toBe("mdp");
    expect(lecturas).not.toHaveBeenCalled();
    expect(await cuentaPrevistaDelPedido({ sucursal: null, facturaSucursal: null })).toBe("igz");
    expect(await cuentaPrevistaDelPedido({})).toBe("igz");
  });

  it("sin sucursal ni predeterminada: null", async () => {
    filas = [];
    expect(await cuentaPrevistaDelPedido({ sucursal: null })).toBeNull();
  });
});

describe("cuentaParaCobrar (sólo la prevista en esta rebanada)", () => {
  beforeEach(() => {
    vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "TEST-t-igz");
    vi.stubEnv("MP_PUBLIC_KEY_IGZ", "TEST-p-igz");
  });

  it("prevista configurada: esa", async () => {
    expect(await cuentaParaCobrar("mercadopago", { sucursal: "igz" })).toEqual({
      ok: true,
      cuenta: "igz",
      prevista: "igz",
      fallback: false,
    });
  });

  it("prevista sin configurar: sin_cuenta aunque otra esté configurada (falla cerrado)", async () => {
    expect(await cuentaParaCobrar("mercadopago", { sucursal: "mdp" })).toEqual({ ok: false, motivo: "sin_cuenta" });
  });

  it("declarada distinta de la prevista: cuenta_no_valida", async () => {
    expect(await cuentaParaCobrar("mercadopago", { sucursal: "igz" }, "mdp")).toEqual({
      ok: false,
      motivo: "cuenta_no_valida",
    });
  });
});

describe("proveedorDeIntento", () => {
  it("liga el proveedor a la cuenta derivada del pedido del intento", async () => {
    const p = await proveedorDeIntento({ proveedor: "payway", sucursal: "igz", facturaSucursal: "mdp" });
    expect(p?.id).toBe("payway");
    expect(p?.cuenta).toBe("mdp");
    expect((await proveedorDeIntento({ proveedor: "mercadopago", sucursal: null }))?.cuenta).toBe("igz");
    expect(await proveedorDeIntento({ proveedor: "desconocido", sucursal: "igz" })).toBeNull();
  });
});
