import type { NextConfig } from "next";
import { describe, expect, it } from "vitest";
import { hrefPedido, RUTAS_MI_CUENTA } from "./mi-cuenta-nav";
import { REDIRECTS_MI_CUENTA } from "./mi-cuenta-redirects";

type Redirects = Awaited<ReturnType<NonNullable<NextConfig["redirects"]>>>;

/**
 * Redirects de las URLs viejas de Mi cuenta (NAV-5), activos en
 * `next.config.ts`.
 */
describe("REDIRECTS_MI_CUENTA", () => {
  it("se puede devolver tal cual desde redirects() de next.config", () => {
    const comoNext: Redirects = [...REDIRECTS_MI_CUENTA];
    expect(comoNext).toHaveLength(3);
  });

  it("?tab=datos → Mis datos, temporal (307)", () => {
    const r = REDIRECTS_MI_CUENTA.find((x) => x.has?.some((h) => h.key === "tab"));
    expect(r).toEqual({
      source: "/mi-cuenta",
      has: [{ type: "query", key: "tab", value: "datos" }],
      destination: RUTAS_MI_CUENTA.datos,
      permanent: false,
    });
  });

  it("detalle viejo /mi-cuenta/pedido/:id → /mi-cuenta/pedidos/:id, permanente (308)", () => {
    const r = REDIRECTS_MI_CUENTA.find((x) => x.source === "/mi-cuenta/pedido/:id");
    expect(r?.destination).toBe(hrefPedido(":id"));
    expect(r?.permanent).toBe(true);
    expect(r?.has).toBeUndefined();
  });

  it("ninguna otra pestaña redirige (compras, vacía o desconocida muestran el resumen)", () => {
    const porTab = REDIRECTS_MI_CUENTA.flatMap((x) => x.has ?? []).filter((h) => h.key === "tab");
    expect(porTab.map((h) => h.value)).toEqual(["datos"]);
  });

  it("todo source vive bajo /mi-cuenta", () => {
    for (const r of REDIRECTS_MI_CUENTA) expect(r.source).toMatch(/^\/mi-cuenta(\/|$)/);
  });
});

describe("Envíos y retiro se unió a Direcciones", () => {
  it("/mi-cuenta/envios → /mi-cuenta/direcciones, permanente (308)", () => {
    const r = REDIRECTS_MI_CUENTA.find((x) => x.source === "/mi-cuenta/envios");
    expect(r).toEqual({
      source: "/mi-cuenta/envios",
      destination: RUTAS_MI_CUENTA.direcciones,
      permanent: true,
    });
  });
});

describe("next.config.ts activa los redirects de Mi cuenta", () => {
  it("redirects() devuelve las reglas, con su 307/308", async () => {
    const { default: nextConfig } = await import("../../next.config");
    expect(nextConfig.redirects).toBeTypeOf("function");
    const reglas = await nextConfig.redirects!();
    for (const r of REDIRECTS_MI_CUENTA) expect(reglas).toContainEqual(r);
    expect(reglas.find((r) => r.source === "/mi-cuenta")).toMatchObject({ permanent: false });
    expect(reglas.find((r) => r.source === "/mi-cuenta/pedido/:id")).toMatchObject({ permanent: true });
  });
});
