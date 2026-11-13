import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";

const { identidadActual, permitirAsync } = vi.hoisted(() => ({
  identidadActual: vi.fn(),
  permitirAsync: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ identidadActual }));
vi.mock("@/lib/rate-limit", () => ({ permitirAsync }));

import { HEADER_TOKEN_PEDIDO, principalDelPedido } from "./invitado-acceso";
import { acuñarTokenCompra, firmarToken } from "./pedido-token";

const PA = "11111111-1111-4111-8111-111111111111";
const PB = "22222222-2222-4222-8222-222222222222";
const SECRETO = "secreto-de-prueba-pedido-link-0123456789";

const anonimo = { clerkUserId: null, cliente: null, esAdmin: false, nombrePila: null };

function req(token: string | null, ip = "203.0.113.7"): Request {
  const headers: Record<string, string> = { "x-forwarded-for": ip };
  if (token !== null) headers[HEADER_TOKEN_PEDIDO] = token;
  return new Request("https://shop.example/api/pedidos/x/pago", { headers });
}

beforeEach(() => {
  vi.stubEnv("PEDIDO_LINK_SECRET", SECRETO);
  vi.stubEnv("SHOP_TENANT_ID", "tenant-a.example");
  identidadActual.mockReset();
  identidadActual.mockResolvedValue(anonimo);
  permitirAsync.mockReset();
  permitirAsync.mockResolvedValue(true);
  setFlag("compra-invitado", true);
});
afterEach(() => vi.unstubAllEnvs());

describe("principalDelPedido: invitado", () => {
  it("token de compra válido de ese pedido => invitado con la tercera llave", async () => {
    const { token } = acuñarTokenCompra(PA);
    const r = await principalDelPedido(req(token), PA);
    expect(r).toEqual({
      ok: true,
      principal: {
        tipo: "invitado",
        orderId: PA,
        dueno: { clerkUserId: null, invitadoOrderId: PA },
        clave: "inv:ip:203.0.113.7",
      },
    });
  });

  it("límites por IP y por pedido (no por token ni cookie)", async () => {
    const { token } = acuñarTokenCompra(PA);
    await principalDelPedido(req(token, "198.51.100.1"), PA);
    const claves = permitirAsync.mock.calls.map((c) => c[0]);
    expect(claves).toEqual(["inv:ip:198.51.100.1", `inv:ped:${PA}`]);
    expect(claves.join()).not.toContain(token);
  });

  it("exceder el límite => limite", async () => {
    permitirAsync.mockResolvedValueOnce(false);
    const { token } = acuñarTokenCompra(PA);
    expect(await principalDelPedido(req(token), PA)).toEqual({ ok: false, motivo: "limite" });
  });

  it("exceder el límite del pedido => limite", async () => {
    permitirAsync.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { token } = acuñarTokenCompra(PA);
    expect(await principalDelPedido(req(token), PA)).toEqual({ ok: false, motivo: "limite" });
  });

  it("sin IP usa una clave fija (no se evade omitiendo el header)", async () => {
    const { token } = acuñarTokenCompra(PA);
    const r = new Request("https://shop.example/x", { headers: { [HEADER_TOKEN_PEDIDO]: token } });
    await principalDelPedido(r, PA);
    expect(permitirAsync.mock.calls[0][0]).toBe("inv:ip:desconocida");
  });
});

describe("principalDelPedido: sin credencial válida", () => {
  const sinCredencial = { ok: false, motivo: "sin_credencial" };

  it("flag apagado => sin credencial, aunque el token sea válido (S1-6)", async () => {
    setFlag("compra-invitado", false);
    const { token } = acuñarTokenCompra(PA);
    expect(await principalDelPedido(req(token), PA)).toEqual(sinCredencial);
    expect(permitirAsync).not.toHaveBeenCalled();
  });

  it("flag encendido sin header => sin credencial", async () => {
    expect(await principalDelPedido(req(null), PA)).toEqual(sinCredencial);
  });

  it("header vacío o basura => sin credencial", async () => {
    expect(await principalDelPedido(req(""), PA)).toEqual(sinCredencial);
    expect(await principalDelPedido(req("basura"), PA)).toEqual(sinCredencial);
  });

  it("token de OTRO pedido (PA sobre PB) => sin credencial, igual que si no hubiera token", async () => {
    const { token } = acuñarTokenCompra(PA);
    expect(await principalDelPedido(req(token), PB)).toEqual(sinCredencial);
  });

  it("sin pedidoId (rutas de lista) => sin credencial", async () => {
    const { token } = acuñarTokenCompra(PA);
    expect(await principalDelPedido(req(token), null)).toEqual(sinCredencial);
    expect(await principalDelPedido(req(token), "")).toEqual(sinCredencial);
  });

  it("firma alterada => sin credencial", async () => {
    const { token } = acuñarTokenCompra(PA);
    const malo = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
    expect(await principalDelPedido(req(malo), PA)).toEqual(sinCredencial);
  });

  it("propósito pago (el link del mail) NO sirve en la API", async () => {
    const link = firmarToken({ proposito: "pago", orderId: PA, venceEn: Date.now() + 60_000 });
    expect(await principalDelPedido(req(link), PA)).toEqual(sinCredencial);
  });

  it("token de otro tenant => sin credencial", async () => {
    const { token } = acuñarTokenCompra(PA);
    vi.stubEnv("SHOP_TENANT_ID", "tenant-b.example");
    expect(await principalDelPedido(req(token), PA)).toEqual(sinCredencial);
  });

  it("sin secreto configurado => sin credencial (falla cerrada, no explota)", async () => {
    const { token } = acuñarTokenCompra(PA);
    vi.stubEnv("PEDIDO_LINK_SECRET", "");
    expect(await principalDelPedido(req(token), PA)).toEqual(sinCredencial);
  });

  it("la respuesta es idéntica para todos los fallos que no son vencimiento (anti-enumeración)", async () => {
    const { token } = acuñarTokenCompra(PA);
    const casos = [
      await principalDelPedido(req(null), PA),
      await principalDelPedido(req(token), PB),
      await principalDelPedido(req("basura"), PA),
    ];
    expect(new Set(casos.map((c) => JSON.stringify(c))).size).toBe(1);
  });
});

describe("principalDelPedido: token vencido", () => {
  it("vencido => token_vencido (el texto en usted lo arma la ruta)", async () => {
    const vencido = firmarToken({ proposito: "compra", orderId: PA, venceEn: Date.now() - 1 });
    expect(await principalDelPedido(req(vencido), PA)).toEqual({ ok: false, motivo: "token_vencido" });
  });

  it("vencido con el flag apagado => sin credencial (el flag apagado no cambia ninguna respuesta)", async () => {
    setFlag("compra-invitado", false);
    const vencido = firmarToken({ proposito: "compra", orderId: PA, venceEn: Date.now() - 1 });
    expect(await principalDelPedido(req(vencido), PA)).toEqual({ ok: false, motivo: "sin_credencial" });
  });
});

describe("principalDelPedido: la sesión prevalece (X4)", () => {
  it("sesión Clerk => cuenta, y el token de invitado se ignora (ni siquiera se mira el flag)", async () => {
    setFlag("compra-invitado", false);
    const identidad = { ...anonimo, clerkUserId: "user_1", email: "ana@cliente.example" };
    identidadActual.mockResolvedValue(identidad);
    const { token } = acuñarTokenCompra(PB);
    const r = await principalDelPedido(req(token), PA);
    expect(r).toEqual({
      ok: true,
      principal: {
        tipo: "cuenta",
        dueno: { clerkUserId: "user_1", clienteCodigo: undefined },
        clave: "user_1",
        email: "ana@cliente.example",
        identidad,
      },
    });
    // La llave del invitado NO se agrega a un dueño con cuenta.
    expect(r.ok && r.principal.dueno).not.toHaveProperty("invitadoOrderId");
    expect(permitirAsync).not.toHaveBeenCalled();
  });

  it("cliente vinculado (cookie del CRM) => cuenta con su código", async () => {
    identidadActual.mockResolvedValue({
      ...anonimo,
      cliente: { codigocliente: "C-1", origen: "cookie_crm" },
    });
    const r = await principalDelPedido(req(null), PA);
    expect(r).toMatchObject({
      ok: true,
      principal: { tipo: "cuenta", dueno: { clerkUserId: null, clienteCodigo: "C-1" }, clave: "C-1" },
    });
  });
});
