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

  it("sin stock: no muestra el contador", () => {
    info.valor = vigente;
    const t = texto(renderToStaticMarkup(<PromoFicha producto={{ ...producto, stock: "out" } as Product} quedan={3} />));
    expect(t).not.toContain("Quedan 3 de 5");
    expect(t).toContain("Agotadas las unidades a precio de apertura");
  });

  it("el ahorro sale del medio destacado (como en la home), no del primero de la ficha", () => {
    info.valor = vigente;
    const enFicha = {
      ...producto,
      precioFinal: 140000,
      precioMedio: undefined,
      preciosMedios: [
        { slug: "cuotas", nombre: "Cuotas", price: 99173, precioFinal: 120000 },
        { slug: "transferencia", nombre: "Transferencia", price: 90908, precioFinal: 109999 },
      ],
    } as unknown as Product;
    const t = texto(renderToStaticMarkup(<PromoFicha producto={enFicha} quedan={3} slugDestacado="transferencia" />));
    expect(t).toContain("−26 %");
    expect(t).not.toContain("−20 %");
  });

  it("con listas por forma del destacado: la línea sin forma, si no la más barata", () => {
    info.valor = vigente;
    const conFormas = {
      ...producto,
      precioMedio: undefined,
      preciosMedios: [
        { slug: "mp", nombre: "MP", price: 1, precioFinal: 120000, forma: "credito" },
        { slug: "mp", nombre: "MP", price: 1, precioFinal: 112500, forma: "debito" },
      ],
    } as unknown as Product;
    expect(texto(renderToStaticMarkup(<PromoFicha producto={conFormas} quedan={3} slugDestacado="mp" />))).toContain("−25 %");
  });

  it("el destacado no está en la ficha: ahorro contra el precio de lista, nunca contra otro medio", () => {
    info.valor = vigente;
    const sinDestacado = {
      ...producto,
      precioFinal: 135000,
      precioMedio: undefined,
      preciosMedios: [{ slug: "cuotas", nombre: "Cuotas", price: 99173, precioFinal: 120000 }],
    } as unknown as Product;
    const t = texto(renderToStaticMarkup(<PromoFicha producto={sinDestacado} quedan={3} slugDestacado="transferencia" />));
    expect(t).toContain("−10 %");
    expect(t).not.toContain("−20 %");
  });

  it("sin promo: nada", () => {
    info.valor = null;
    expect(renderToStaticMarkup(<PromoFicha producto={producto} quedan={3} />)).toBe("");
  });
});
