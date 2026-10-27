import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PromoProvider, suscribirVigencia, usePromoProducto } from "./PromoProvider";

const datos = {
  inicio: undefined,
  fin: "2999-01-01T00:00:00-03:00",
  etiquetaBadge: "Precio de apertura",
  tituloComparador: "Nosotros comparamos. Usted ahorra.",
  legales: undefined,
  estrellaSku: "NK-1",
  unidadesPromo: 5,
  productos: { "NK-1": { habitual: 132172 } },
};

function Sonda({ sku }: { sku: string }) {
  const info = usePromoProducto(sku);
  return <span>{info ? info.etiquetaBadge : "sin-promo"}</span>;
}

describe("PromoProvider", () => {
  it("en el servidor no hay promo (snapshot null): sin mismatch de hidratación", () => {
    const html = renderToStaticMarkup(
      <PromoProvider datos={datos}>
        <Sonda sku="NK-1" />
      </PromoProvider>,
    );
    expect(html).toContain("sin-promo");
  });

  it("sin provider, sin promo", () => {
    expect(renderToStaticMarkup(<Sonda sku="NK-1" />)).toContain("sin-promo");
  });
});

describe("suscribirVigencia (sin reloj de 1 s en las cards)", () => {
  afterEach(() => vi.useRealTimers());

  it("sin promo no programa ningún timer", () => {
    vi.useFakeTimers();
    const baja = suscribirVigencia(null)(() => {});
    expect(vi.getTimerCount()).toBe(0);
    baja();
  });

  it("con promo programa un solo timer hasta el próximo corte y avisa al cruzarlo", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-11-13T23:00:00-03:00"));
    const aviso = vi.fn();
    const baja = suscribirVigencia({ ...datos, fin: "2026-11-13T23:59:00-03:00" })(aviso);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(59 * 60 * 1000);
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    baja();
  });
});
