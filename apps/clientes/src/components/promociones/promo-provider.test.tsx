import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PromoProvider, usePromoProducto } from "./PromoProvider";

const datos = {
  inicio: undefined,
  fin: "2999-01-01T00:00:00-03:00",
  etiquetaBadge: "Precio de apertura",
  etiquetaReferencia: "En otras tiendas desde",
  legales: undefined,
  estrellaSku: "NK-1",
  unidadesPromo: 5,
  refs: { "NK-1": 150000 },
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
