import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Product } from "@/data/products";
import { DEFAULTS_HOME, type PromocionesContent } from "@/data/home-defaults";

vi.mock("@/components/TarjetaProductoCarrusel", () => ({
  TarjetaProductoCarrusel: ({ producto }: { producto: Product }) => <div data-card={producto.sku}>{producto.name}</div>,
}));
vi.mock("@/components/BotonFavorito", () => ({ BotonFavorito: () => null }));
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
    expect(t).toContain("26 % más barato");
    expect(t).toContain("Agregar");
    expect(t).toContain("Kit Candle");
  });

  it("se presenta como lanzamiento: cinta con el eyebrow y cuenta regresiva en cajas", () => {
    const t = texto(vista());
    expect(t).toContain(contenido.eyebrow!);
    expect(t).toContain("La promo termina en");
    for (const unidad of ["días", "horas", "min", "seg"]) expect(t).toContain(unidad);
  });

  it("la oferta se entiende: etiqueta que dice contra qué es el descuento y ahorro en pesos", () => {
    const t = texto(vista());
    expect(vista()).toContain('data-sello="descuento"');
    expect(t).toContain("26 % más barato");
    expect(t).toContain("que en otras tiendas");
    expect(t).toContain("$ 40.001 menos que en otras tiendas");
    expect(t).not.toContain("Ahorre");
  });

  it("unidades en casilleros: uno por unidad, libres y vendidas", () => {
    const html = vista();
    expect(html).toContain('data-sello="unidades"');
    expect(html.match(/data-unidad="libre"/g)).toHaveLength(3);
    expect(html.match(/data-unidad="vendida"/g)).toHaveLength(2);
    expect(texto(html)).toContain("Quedan 3 de 5 unidades a precio de apertura");
    expect(texto(html)).toContain("Después vuelve a su precio normal");
  });

  it("cada oferta lleva sobre la foto su ahorro; sin referencia no queda un hueco", () => {
    const sinRef = { id: "3", sku: "B2", name: "Panel", brand: "Macroled", price: 5, stock: "in" } as Product;
    const html = vista({ items: [item, sinRef], contenido: { ...contenido, items: [...contenido.items, { sku: "B2" }] } });
    expect(html).toContain('data-sello-item="A1"');
    expect(html.match(/data-ahorro=/g)).toHaveLength(2); // la estrella y A1, no B2
    expect(texto(html)).toContain("$ 66.999 menos que en otras tiendas");
  });

  it("las ofertas muestran como precio principal el de transferencia", () => {
    const conMedio = { ...item, precioFinal: 1210, precioMedio: { slug: "transferencia", nombre: "Transferencia", price: 800, precioFinal: 968 } } as Product;
    const t = texto(vista({ items: [conMedio] }));
    expect(t).toContain("$ 968");
    expect(t).not.toContain("1.210");
  });

  it("no muestra el precio de lista en la estrella", () => {
    const t = texto(vista());
    expect(t).toContain("109.999");
    expect(t).not.toContain("108.900");
  });

  it("quedan 2: últimas unidades", () => {
    expect(texto(vista({ estrella: { producto: estrellaProd, quedan: 2 } }))).toContain("¡Últimas 2 unidades!");
  });

  it("quedan 0: agotada, sin agregar y con enlace a la ficha", () => {
    const html = vista({ estrella: { producto: estrellaProd, quedan: 0 }, items: [] });
    expect(texto(html)).toContain("Agotadas las unidades a precio de apertura");
    expect(texto(html)).not.toContain("Agregar");
    expect(html).toContain('href="/producto/22596"');
  });

  it("sin stock en la tienda: agotada aunque el contador diga que quedan", () => {
    const t = texto(vista({ estrella: { producto: { ...estrellaProd, stock: "out" } as Product, quedan: 3 }, items: [] }));
    expect(t).toContain("Agotadas las unidades a precio de apertura");
    expect(t).not.toContain("Quedan 3 de 5");
    expect(t).not.toContain("Agregar");
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

  it("SKU cargado que no se resuelve: en edición lo nombra en vez de pedir que cargue productos", () => {
    const t = texto(vista({ estrella: null, items: [], noResueltos: ["NK-1"], edicion: true }));
    expect(t).toContain("No se encontró o está oculto: NK-1");
    expect(t).not.toContain("Cargue un producto estrella");
  });

  it("varios SKUs no resueltos junto a los visibles: aviso en edición, nada para el visitante", () => {
    expect(texto(vista({ noResueltos: ["B2", "C3"], edicion: true }))).toContain("No se encontró o está oculto: B2, C3");
    expect(texto(vista({ noResueltos: ["B2", "C3"] }))).not.toContain("No se encontró");
  });

  it("no resuelto y programada: los dos avisos", () => {
    const t = texto(vista({ estado: "programada", noResueltos: ["B2"], edicion: true }));
    expect(t).toContain("No se encontró o está oculto: B2");
    expect(t).toContain("Programada: empieza el 3/11");
  });

  it("legales con las fechas reemplazadas", () => {
    expect(texto(vista())).toContain("Promoción válida del 3/11 al 13/11 o hasta agotar 5 unidades");
  });
});
