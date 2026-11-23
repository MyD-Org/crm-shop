import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Sesión del chat según la cuenta de Alegra del despliegue (change `shop-contactos-alegra-mdp`, D4):
 * el `crm_token` resuelve el `codigocliente` en la cuenta principal del CRM, así que con una cuenta
 * secundaria el vinculado chatea como `registrado`, sin token. Datos inventados.
 */

vi.mock("./agent-token", () => ({ mintAgentToken: (codigo: string, tenant: string) => `token:${tenant}:${codigo}` }));

import { PREFIJO_CLERK, sesionChat } from "./chat-ia-sesion";

const VINCULADO = {
  clerkUserId: "user_1",
  nombre: "Carla",
  cliente: { codigocliente: "123", razonsocial: "Cliente Demo SRL", origen: "vinculacion" as const },
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sesionChat", () => {
  it("cuenta principal: el vinculado es `cliente` con crm_token y external_id = codigocliente", () => {
    expect(sesionChat(VINCULADO, "tenant-a", "v")).toEqual({
      external_id: "123",
      display_name: "Cliente Demo SRL",
      claims: { tier: "cliente", crm_token: "token:tenant-a:123" },
    });
  });

  it("cuenta secundaria: el vinculado es `registrado`, sin crm_token ni su codigocliente", () => {
    vi.stubEnv("SHOP_CUENTA_ALEGRA", "mdp");
    const s = sesionChat(VINCULADO, "tenant-a", "v");
    expect(s).toEqual({ external_id: `${PREFIJO_CLERK}user_1`, display_name: "Carla", claims: { tier: "registrado" } });
    expect(JSON.stringify(s)).not.toContain("token:");
  });
});
