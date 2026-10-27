import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Product } from "@/data/products";
import { LEGALES_DEFAULT } from "@/lib/promociones/promo";

const info = vi.hoisted(() => ({ valor: null as unknown }));
vi.mock("./PromoProvider", () => ({ usePromoProducto: () => info.valor }));

import { PromoFicha } from "./PromoFicha";

const producto = {
  id: "22596",
  sku: "NK-1",
  name: "Ventilador",
  brand: "Noak",
  price: 90000,
  stock: "in",
  precioMedio: { slug: "transferencia", nombre: "Transferencia", price: 90908, precioFinal: 109999 },
} as unknown as Product;
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const vigente = {
  etiquetaBadge: "Precio de apertura",
  etiquetaReferencia: "En otras tiendas desde",
  referencia: 150000,
  fin: "2026-11-13T23:59:00-03:00",
  inicio: "2026-11-03T00:00:00-03:00",
  legales: LEGALES_DEFAULT,
  unidadesPromo: 5,
  esEstrella: true,
};

describe("PromoFicha", () => {
  it("con promo: etiqueta, referencia con ahorro, fin y legales", () => {
    info.valor = vigente;
    const t = texto(renderToStaticMarkup(<PromoFicha producto={producto} quedan={3} />));
    expect(t).toContain("Precio de apertura");
    expect(t).toContain("En otras tiendas desde");
    expect(t).toContain("−26 %");
    expect(t).toContain("Termina el 13/11");
    expect(t).toContain("Quedan 3 de 5");
    expect(t).toContain("Promoción válida del 3/11 al 13/11");
  });

  it("quedan 2: últimas unidades", () => {
    info.valor = vigente;
    expect(texto(renderToStaticMarkup(<PromoFicha producto={producto} quedan={2} />))).toContain("¡Últimas unidades!");
  });

  it("sin promo: nada", () => {
    info.valor = null;
    expect(renderToStaticMarkup(<PromoFicha producto={producto} quedan={3} />)).toBe("");
  });
});
