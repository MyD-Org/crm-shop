import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Product } from "@/data/products";
import { DEFAULTS_HOME, type PromocionesContent } from "@/data/home-defaults";

vi.mock("@/components/TarjetaProductoCarrusel", () => ({
  TarjetaProductoCarrusel: ({ producto }: { producto: Product }) => <div data-card={producto.sku}>{producto.name}</div>,
}));
vi.mock("@/components/AddToCartButton", () => ({
  AddToCartButton: () => <button type="button">Agregar</button>,
}));

import { PromocionesVista } from "./PromocionesVista";

const FIN = "2026-11-13T23:59:00-03:00";
const estrellaProd = {
  id: "22596",
  sku: "NK-1",
  name: "Ventilador de techo Noak Slim 42",
  brand: "Noak",
  price: 90000,
  precioFinal: 108900,
  precioMedio: { slug: "transferencia", nombre: "Transferencia", price: 90908, precioFinal: 109999 },
  stock: "in",
  images: [{ url: "/v.webp", w: 800 }],
} as unknown as Product;
const item = { id: "2", sku: "A1", name: "Kit Candle", brand: "Macroled", price: 1, stock: "in" } as Product;

const contenido: PromocionesContent = {
  ...DEFAULTS_HOME.promociones,
  inicio: "2026-11-03T00:00:00-03:00",
  fin: FIN,
  estrella: { sku: "NK-1", precioReferencia: 150000, unidadesPromo: 5, stockBase: 10 },
  items: [{ sku: "A1", precioReferencia: 67000 }],
};

const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const vista = (props: Partial<Parameters<typeof PromocionesVista>[0]> = {}) =>
  renderToStaticMarkup(
    <PromocionesVista
      contenido={contenido}
      estrella={{ producto: estrellaProd, quedan: 3 }}
      items={[item]}
      estado="vigente"
      edicion={false}
      {...props}
    />,
  );

describe("PromocionesVista", () => {
  it("vigente: unidades, referencia, ahorro y botón de agregar", () => {
    const t = texto(vista());
    expect(t).toContain("Quedan 3 de 5");
    expect(t).toContain("En otras tiendas desde");
    expect(t).toContain("−26 %");
    expect(t).toContain("Agregar");
    expect(t).toContain("Kit Candle");
  });

  it("no muestra el precio de lista en la estrella", () => {
    const t = texto(vista());
    expect(t).toContain("109.999");
    expect(t).not.toContain("108.900");
  });

  it("quedan 2: últimas unidades", () => {
    expect(texto(vista({ estrella: { producto: estrellaProd, quedan: 2 } }))).toContain("¡Últimas unidades!");
  });

  it("quedan 0: agotada, sin agregar y con enlace a la ficha", () => {
    const html = vista({ estrella: { producto: estrellaProd, quedan: 0 } });
    expect(texto(html)).toContain("Agotadas las unidades a precio de apertura");
    expect(texto(html)).not.toContain("Agregar");
    expect(html).toContain('href="/producto/22596"');
  });

  it("quedan 0 en edición: avisa que hay que quitar el ajuste en el CRM", () => {
    expect(texto(vista({ estrella: { producto: estrellaProd, quedan: 0 }, edicion: true }))).toContain(
      "Quite el ajuste de precio del producto en Precios online del CRM.",
    );
  });

  it("terminada: nada para el visitante, aviso en edición", () => {
    expect(vista({ estado: "terminada" })).toBe("");
    expect(texto(vista({ estado: "terminada", edicion: true }))).toContain("Terminó el 13/11");
  });

  it("programada en edición: avisa cuándo empieza", () => {
    expect(vista({ estado: "programada" })).toBe("");
    expect(texto(vista({ estado: "programada", edicion: true }))).toContain("Programada: empieza el 3/11");
  });

  it("sin productos visibles: nada para el visitante, aviso en edición", () => {
    expect(vista({ estrella: null, items: [] })).toBe("");
    expect(texto(vista({ estrella: null, items: [], edicion: true }))).toContain("Cargue un producto estrella");
  });

  it("legales con las fechas reemplazadas", () => {
    expect(texto(vista())).toContain("Promoción válida del 3/11 al 13/11 o hasta agotar 5 unidades");
  });
});
