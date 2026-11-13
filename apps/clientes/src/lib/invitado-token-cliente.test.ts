import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HEADER_TOKEN_PEDIDO,
  conTokenInvitado,
  fetchConToken,
  fijarTokenInvitado,
  tokenInvitado,
  urlSinToken,
} from "./invitado-token-cliente";

// Valor de prueba corto: no es un secreto, sólo tiene la forma de un token.
const VALOR_PRUEBA = "v1.pedido-de-prueba";

afterEach(() => {
  fijarTokenInvitado(null);
  vi.unstubAllGlobals();
});

describe("token del invitado en memoria", () => {
  it("sin token no agrega ningún header", () => {
    const init = { method: "POST" };
    expect(conTokenInvitado("/api/pedidos/1/medio", init)).toBe(init);
  });

  it("con token agrega X-Pedido-Token en las rutas del pedido y del cobro", () => {
    fijarTokenInvitado(VALOR_PRUEBA);
    for (const url of ["/api/pedidos/1/medio", "/api/pedidos/pendiente?pedido=1", "/api/pagos/mercadopago/preferencia"]) {
      const init = conTokenInvitado(url, { headers: { "Content-Type": "application/json" } });
      const h = new Headers(init?.headers);
      expect(h.get(HEADER_TOKEN_PEDIDO)).toBe(VALOR_PRUEBA);
      expect(h.get("Content-Type")).toBe("application/json");
    }
  });

  it("no manda el token a otras rutas ni a otros orígenes", () => {
    fijarTokenInvitado(VALOR_PRUEBA);
    expect(conTokenInvitado("/api/geocode?q=x", undefined)).toBeUndefined();
    expect(conTokenInvitado("/api/mi-cuenta/direcciones", undefined)).toBeUndefined();
    expect(conTokenInvitado("https://api.ejemplo.example/api/pedidos", undefined)).toBeUndefined();
  });

  it("fetchConToken llama al fetch global con el header y sin tocar la URL (el token no va en la query)", async () => {
    const f = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", f);
    fijarTokenInvitado(VALOR_PRUEBA);
    await fetchConToken("/api/pedidos/1/avisos", { method: "POST", keepalive: true });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/pedidos/1/avisos");
    expect(new Headers(init.headers).get(HEADER_TOKEN_PEDIDO)).toBe(VALOR_PRUEBA);
    expect(init.keepalive).toBe(true);
  });

  it("fijar un valor vacío o nulo borra el token", () => {
    fijarTokenInvitado(VALOR_PRUEBA);
    fijarTokenInvitado("");
    expect(tokenInvitado()).toBeNull();
  });
});

describe("urlSinToken", () => {
  it("quita t y conserva el resto de la query", () => {
    expect(urlSinToken("https://tienda.example/checkout?pedido=1&pago=mp&t=abc&payment_id=9")).toBe(
      "/checkout?pedido=1&pago=mp&payment_id=9",
    );
  });
  it("sin t devuelve null (no hay nada que reescribir)", () => {
    expect(urlSinToken("https://tienda.example/checkout?pedido=1")).toBeNull();
  });
  it("si t era lo único, queda la ruta sola", () => {
    expect(urlSinToken("https://tienda.example/checkout?t=abc")).toBe("/checkout");
  });
});

describe("nada en el navegador", () => {
  const SRC = join(__dirname, "..");
  const ARCHIVOS = [
    "lib/invitado-token-cliente.ts",
    "lib/invitado-form.ts",
    "components/TurnstileWidget.tsx",
    "components/FormularioInvitado.tsx",
    "components/CheckoutClient.tsx",
  ];
  it.each(ARCHIVOS)("%s no usa cookies ni almacenamiento del navegador", (archivo) => {
    // Sin comentarios: los de documentación mencionan justamente lo que no se usa.
    const texto = readFileSync(join(SRC, archivo), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    expect(texto).not.toMatch(/document\.cookie/);
    expect(texto).not.toMatch(/localStorage/);
    expect(texto).not.toMatch(/sessionStorage/);
    expect(texto).not.toMatch(/indexedDB/);
  });
});
