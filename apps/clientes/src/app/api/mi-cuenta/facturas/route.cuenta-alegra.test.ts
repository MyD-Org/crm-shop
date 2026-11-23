import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mi cuenta hereda la cuenta de Alegra del despliegue por `apiFetch` (change
 * `shop-contactos-alegra-mdp`): con `SHOP_CUENTA_ALEGRA=mdp` y sin sus credenciales, la página de
 * facturas responde el error genérico en usted y NO sale ningún request (nunca cae a las
 * credenciales de la principal). Con las credenciales de la cuenta, el request lleva las suyas.
 * Sólo la identidad está mockeada: erp-cc, alegra-cc y alegra son los reales. Datos inventados.
 */

const identidad = vi.fn();
vi.mock("@/lib/auth", () => ({ identidadActual: () => identidad() }));
vi.mock("@/lib/acceso-facturacion", () => ({ accesoFacturacion: async () => true }));

import { FACTURAS_CAIDAS } from "@/lib/cuenta-corriente/mensajes";
import { GET } from "./route";

const fetchMock = vi.fn();

beforeEach(() => {
  identidad.mockResolvedValue({ clerkUserId: "user_1", cliente: { codigocliente: "123", origen: "vinculacion" } });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("ALEGRA_EMAIL", "principal@cliente.example");
  vi.stubEnv("ALEGRA_TOKEN", "token-principal");
  vi.stubEnv("SHOP_CUENTA_ALEGRA", "mdp");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/mi-cuenta/facturas con cuenta de Alegra secundaria", () => {
  it("sin credenciales de la cuenta: error genérico en usted y ningún request a Alegra", async () => {
    const res = await GET(new Request("http://localhost/api/mi-cuenta/facturas"));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: FACTURAS_CAIDAS });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("con credenciales de la cuenta: el request sale con las de esa cuenta, nunca las de la principal", async () => {
    vi.stubEnv("ALEGRA_EMAIL_MDP", "mdp@cliente.example");
    vi.stubEnv("ALEGRA_TOKEN_MDP", "token-mdp");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [], metadata: { total: 0 } }), { status: 200 }));
    const res = await GET(new Request("http://localhost/api/mi-cuenta/facturas"));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
    const esperado = `Basic ${Buffer.from("mdp@cliente.example:token-mdp").toString("base64")}`;
    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe(esperado);
    }
  });
});
