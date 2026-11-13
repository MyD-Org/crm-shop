import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

const REDIRECT = new Error("NEXT_REDIRECT");
const redirect = vi.fn((d: string) => {
  void d;
  throw REDIRECT;
});
vi.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
const headersMock = vi.fn();
vi.mock("next/headers", () => ({ headers: () => headersMock() }));
const permitirAsync = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ permitirAsync: (...a: unknown[]) => permitirAsync(...a) }));
const getPedidoParaLink = vi.fn();
vi.mock("@/lib/pedidos", () => ({ getPedidoParaLink: (...a: unknown[]) => getPedidoParaLink(...a) }));
vi.mock("next/link", () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock("@myd-org/ui", () => ({ Button: ({ children }: { children: unknown }) => children }));

process.env.PEDIDO_LINK_SECRET = "x".repeat(40);
process.env.SHOP_TENANT_ID = "tenant-test";
import { tokenLinkPago } from "@/lib/pedido-link-pago";
import { acuñarTokenCompra, firmarToken, verificarToken } from "@/lib/pedido-token";
import { limpiar } from "@/test/registro-usted";
import { TEXTOS_PAGAR } from "@/lib/pagar-textos";
import PagarPage from "./page";

const ID = "11111111-1111-4111-8111-111111111111";
const OTRO = "22222222-2222-4222-8222-222222222222";
const link = (id = ID) => tokenLinkPago({ orderId: id, creadoEn: Date.now(), reservaVenceEn: null, enLinea: true })!;
const abrir = (token: string) => PagarPage({ params: Promise.resolve({ token }) });
const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);

beforeEach(() => {
  redirect.mockClear();
  headersMock.mockResolvedValue(new Headers({ "x-forwarded-for": "203.0.113.9" }));
  permitirAsync.mockReset().mockResolvedValue(true);
  getPedidoParaLink.mockReset().mockResolvedValue("disponible");
});

describe("/pagar/[token]", () => {
  it("vigente y pendiente => acuña un token de compra de ESE pedido y retoma el pago en /checkout", async () => {
    await expect(abrir(link())).rejects.toBe(REDIRECT);
    const destino = new URL(redirect.mock.calls[0][0], "https://shop.example");
    expect(destino.pathname).toBe("/checkout");
    expect(destino.searchParams.get("pedido")).toBe(ID);
    expect(verificarToken(destino.searchParams.get("t")!, "compra")).toMatchObject({ ok: true, orderId: ID });
  });

  it("pagado => 'ya fue pagado', sin redirigir ni detalle", async () => {
    getPedidoParaLink.mockResolvedValue("pagado");
    expect(html(await abrir(link()))).toContain(TEXTOS_PAGAR.pagado);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("no disponible, vencido, alterado, de otro propósito o basura: la MISMA respuesta genérica", async () => {
    getPedidoParaLink.mockResolvedValue("no_disponible");
    const vencido = firmarToken({ proposito: "pago", orderId: ID, venceEn: Date.now() - 1 });
    const casos = [link(), vencido, link().replace(ID, OTRO), acuñarTokenCompra(ID).token, "basura", ""];
    const salidas = new Set<string>();
    for (const c of casos) salidas.add(html(await abrir(c)));
    expect(salidas.size).toBe(1);
    expect([...salidas][0]).toContain(TEXTOS_PAGAR.noDisponible);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("un link inválido ni consulta la base", async () => {
    await abrir("basura");
    expect(getPedidoParaLink).not.toHaveBeenCalled();
  });

  it("límite por IP (20/min) => mensaje en usted y no consulta nada", async () => {
    permitirAsync.mockResolvedValue(false);
    expect(html(await abrir(link()))).toContain(TEXTOS_PAGAR.limite);
    expect(permitirAsync).toHaveBeenCalledWith("pagar:ip:203.0.113.9", 20, 60_000);
    expect(getPedidoParaLink).not.toHaveBeenCalled();
  });

  it("no depende del flag compra-invitado y no muestra datos personales", () => {
    const fuente = limpiar(readFileSync(new URL("./page.tsx", import.meta.url), "utf8"));
    expect(fuente).not.toMatch(/compraInvitadoHabilitada|compra-invitado-flag/);
    expect(fuente).not.toMatch(/nroDoc|facturacion|telefono|domicilio/i);
  });
});
