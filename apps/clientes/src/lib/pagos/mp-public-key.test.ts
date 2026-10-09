import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cuentaDelPedido = vi.fn();
const rechazadas = vi.fn<(...a: unknown[]) => Promise<string[]>>(async () => []);
vi.mock("@/lib/pedidos", () => ({
  cuentasRechazadasDelPedido: (...a: unknown[]) => rechazadas(...a),
  cuentaDelPedido: (id: string) => cuentaDelPedido(id),
}));

// Sucursales del CRM: igz predeterminada y mdp.
vi.mock("@/lib/tenant", () => ({ shopTenantId: () => "tenant-ejemplo" }));
vi.mock("@/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => [
          { slug: "igz", activa: true, predeterminada: true },
          { slug: "mdp", activa: true, predeterminada: false },
        ],
      }),
    }),
  }),
}));

import { configMpPara } from "./mp-public-key";
import { limpiarMemoCuentas } from "./cuentas-sucursales";

beforeEach(() => {
  limpiarMemoCuentas();
  vi.stubEnv("MP_ACCESS_TOKEN_IGZ", "TEST-token-igz");
  vi.stubEnv("MP_PUBLIC_KEY_IGZ", "TEST-publica-igz");
  vi.stubEnv("MP_ACCESS_TOKEN_MDP", "TEST-token-mdp");
  vi.stubEnv("MP_PUBLIC_KEY_MDP", "TEST-publica-mdp");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("configMpPara (public key del Brick por pedido)", () => {
  it("pedido de mdp: la key de mdp; pedido de igz: la de igz", async () => {
    expect(await configMpPara({ sucursal: "mdp", facturaSucursal: null }, "mercadopago")).toEqual({
      mpPublicKey: "TEST-publica-mdp",
      mpCuenta: "mdp",
    });
    expect(await configMpPara({ sucursal: "igz", facturaSucursal: null }, "mercadopago")).toEqual({
      mpPublicKey: "TEST-publica-igz",
      mpCuenta: "igz",
    });
  });

  it("la zona que fuerza la factura manda; sin sucursal, la predeterminada", async () => {
    expect((await configMpPara({ sucursal: "igz", facturaSucursal: "mdp" }, "mercadopago")).mpCuenta).toBe("mdp");
    expect((await configMpPara({ sucursal: null, facturaSucursal: null }, "mercadopago")).mpCuenta).toBe("igz");
  });

  it("con el id lee la sucursal del pedido (retomar un pedido)", async () => {
    cuentaDelPedido.mockResolvedValue({ sucursal: "mdp", facturaSucursal: null });
    expect(await configMpPara("pedido-1", "mercadopago")).toEqual({ mpPublicKey: "TEST-publica-mdp", mpCuenta: "mdp" });
    expect(cuentaDelPedido).toHaveBeenCalledWith("pedido-1");
  });

  it("la cuenta del pedido sin configurar: la key de la alternativa configurada", async () => {
    vi.stubEnv("MP_PUBLIC_KEY_MDP", "");
    expect(await configMpPara({ sucursal: "mdp", facturaSucursal: null }, "mercadopago")).toEqual({
      mpPublicKey: "TEST-publica-igz",
      mpCuenta: "igz",
    });
  });

  it("retomar un pedido cuya cuenta ya rechazó el procesador: la key de la otra", async () => {
    cuentaDelPedido.mockResolvedValue({ sucursal: "mdp", facturaSucursal: null });
    rechazadas.mockResolvedValueOnce(["mdp"]);
    expect(await configMpPara("pedido-1", "mercadopago")).toEqual({ mpPublicKey: "TEST-publica-igz", mpCuenta: "igz" });
    expect(rechazadas).toHaveBeenCalledWith("pedido-1", "mercadopago");
  });

  it("ninguna cuenta configurada: nada (el formulario no se monta)", async () => {
    vi.stubEnv("MP_PUBLIC_KEY_MDP", "");
    vi.stubEnv("MP_PUBLIC_KEY_IGZ", "");
    expect(await configMpPara({ sucursal: "mdp", facturaSucursal: null }, "mercadopago")).toEqual({});
  });

  it("ignora la key pública del navegador y las variables sin sufijo", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_MP_PUBLIC_KEY", "TEST-vieja");
    vi.stubEnv("MP_ACCESS_TOKEN", "TEST-vieja");
    expect(await configMpPara({ sucursal: "igz", facturaSucursal: null }, "mercadopago")).toEqual({});
  });

  it("otro medio (Payway, transferencia): nada", async () => {
    expect(await configMpPara({ sucursal: "igz", facturaSucursal: null }, "payway")).toEqual({});
    expect(await configMpPara({ sucursal: "igz", facturaSucursal: null }, "transferencia")).toEqual({});
  });

  it("si falla la lectura del pedido, nada (no rompe la respuesta)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    cuentaDelPedido.mockRejectedValue(new Error("base caída"));
    expect(await configMpPara("pedido-1", "mercadopago")).toEqual({});
  });
});
