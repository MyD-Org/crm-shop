import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CampaniaProducto, Product } from "@/data/products";
import { badgeCampania, propsCardCampania } from "./PromoProvider";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// Reloj fijo: 26/11/2026 12:00 (Argentina). BF termina el 30/11 23:59, a 4 días.
const reloj = vi.hoisted(() => ({ ahora: Date.parse("2026-11-26T15:00:00.000Z") as number | null }));
vi.mock("./reloj", () => ({ useAhora: () => reloj.ahora }));
const { CampaniaFicha, PestaniaOferta, habitualYAhorro, mostrarFin } = await import("./CampaniaFicha");

// Campañas de precios en cards y ficha (spec 2026-10-28-campanias-precios-design.md). Datos inventados.

const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const BF: CampaniaProducto = { id: "c1", nombre: "Black Friday", etiqueta: "BF", fin: "2026-12-01T02:59:00.000Z", pct: 20, unidades: null, quedan: null };
const producto = { id: "7", name: "Lámpara", price: 128, precioFinal: 154.88, oldPrice: 193.6, stock: "in", campania: BF } as unknown as Product;

describe("badgeCampania (cards)", () => {
  it("pestaña con la etiqueta y el % en el acento de la marca, nunca en rojo", () => {
    const html = renderToStaticMarkup(<>{badgeCampania(BF)}</>);
    expect(texto(html)).toContain("BF");
    expect(texto(html)).toContain("−20 % de descuento");
    expect(html).toContain("bg-accent");
    expect(html).toContain("text-accent");
    expect(html).not.toContain("danger");
  });

  it("propsCardCampania: card resaltada y badge en la esquina sólo con campaña", () => {
    expect(propsCardCampania(BF)).toEqual({ highlight: "accent", badgePlacement: "corner" });
    expect(propsCardCampania(undefined)).toEqual({});
  });
});

describe("CampaniaFicha", () => {
  it("recuadro con el acento, el normal tachado, el % y el ahorro en pesos, y el fin", () => {
    const html = renderToStaticMarkup(<CampaniaFicha producto={producto} />);
    const t = texto(html);
    expect(html).toContain("border-accent");
    expect(t).toContain("BF");
    expect(t).toContain("Precio habitual");
    expect(t).toContain("20 % menos");
    expect(t).toMatch(/Ahorre \$ ?38,72/);
    expect(t).toContain("Termina el 30/11");
    expect(html).not.toContain("danger");
  });

  it("con transferencia: tachado y ahorro de esa lista (los mismos que el carrito)", () => {
    const conMedio = {
      ...producto,
      precioMedio: { slug: "transferencia", nombre: "Transferencia", price: 105, precioFinal: 127.05 },
      campania: { ...BF, habitualMedio: 158.81 },
    } as unknown as Product;
    expect(habitualYAhorro(conMedio)).toEqual({ habitual: 158.81, ahorro: 31.76, medio: "Transferencia" });
    const t = texto(renderToStaticMarkup(<CampaniaFicha producto={conMedio} />));
    expect(t).toMatch(/Precio habitual \$ ?158,81 con Transferencia/);
    expect(t).toMatch(/Ahorre \$ ?31,76/);
    expect(t).not.toContain("193,60");
  });

  it("ficha: el medio de sus líneas (transferencia) contra su propio habitual, el mismo que el carrito", () => {
    const ficha = {
      ...producto,
      preciosMedios: [{ slug: "transferencia", nombre: "Transferencia", price: 105, precioFinal: 127.05 }],
      campania: { ...BF, habitualesMedios: [{ slug: "transferencia", precioFinal: 158.81 }] },
    } as unknown as Product;
    expect(habitualYAhorro(ficha)).toEqual({ habitual: 158.81, ahorro: 31.76, medio: "Transferencia" });
  });

  it("sin el habitual del medio, la lista general como antes", () => {
    expect(habitualYAhorro(producto)).toEqual({ habitual: 193.6, ahorro: 38.72 });
  });

  it("sin precio final no inventa el ahorro", () => {
    const t = texto(renderToStaticMarkup(<CampaniaFicha producto={{ ...producto, precioFinal: undefined } as unknown as Product} />));
    expect(t).toContain("20 % menos");
    expect(t).not.toContain("Ahorre");
  });

  it("campaña larga: no anuncia el fin ni la cuenta regresiva", () => {
    const lejana = { ...BF, fin: "2027-06-30T02:59:00.000Z" };
    const t = texto(renderToStaticMarkup(<CampaniaFicha producto={{ ...producto, campania: lejana }} />));
    expect(t).toContain("20 % menos");
    expect(t).not.toContain("Termina");
  });

  it("«Hasta agotar stock»: lo dice en lugar del fin y sin cuenta regresiva, aunque falten pocos días", () => {
    const html = renderToStaticMarkup(<CampaniaFicha producto={{ ...producto, campania: { ...BF, hastaAgotarStock: true } }} />);
    const t = texto(html);
    expect(t).toContain("Hasta agotar stock");
    expect(t).toContain("20 % menos");
    expect(t).not.toContain("Termina");
  });

  it("«Hasta agotar stock» con una campaña lejana: igual lo dice", () => {
    const lejana = { ...BF, fin: "2027-06-30T02:59:00.000Z", hastaAgotarStock: true as const };
    const t = texto(renderToStaticMarkup(<CampaniaFicha producto={{ ...producto, campania: lejana }} />));
    expect(t).toContain("Hasta agotar stock");
    expect(t).not.toContain("Termina");
  });

  it("con límite chico: un punto por unidad (2 libres de 5) y la urgencia", () => {
    const html = renderToStaticMarkup(<CampaniaFicha producto={{ ...producto, campania: { ...BF, unidades: 5, quedan: 2 } }} />);
    expect(texto(html)).toContain("¡Últimas 2 unidades a precio de BF!");
    expect(html.match(/data-unidad="libre"/g)).toHaveLength(2);
    expect(html.match(/data-unidad="vendida"/g)).toHaveLength(3);
  });

  it("con muchas unidades: \"Quedan N de M\" neutro, sin la urgencia en rojo", () => {
    const html = renderToStaticMarkup(<CampaniaFicha producto={{ ...producto, campania: { ...BF, etiqueta: "Black Friday", unidades: 200, quedan: 150 } }} />);
    expect(texto(html)).toContain("Quedan 150 de 200 a precio de Black Friday");
    expect(html).not.toContain("text-danger");
    expect(texto(html)).not.toContain("¡Últimas");
  });

  it("con 2 o menos, la urgencia: \"¡Últimas 2 unidades\"", () => {
    const t = texto(renderToStaticMarkup(<CampaniaFicha producto={{ ...producto, campania: { ...BF, unidades: 200, quedan: 2 } }} />));
    expect(t).toContain("¡Últimas 2 unidades");
  });

  it("agotadas: lo dice y no ofrece unidades", () => {
    const t = texto(renderToStaticMarkup(<CampaniaFicha producto={{ ...producto, campania: { ...BF, unidades: 5, quedan: 0 } }} />));
    expect(t).toContain("Agotadas las unidades a precio de BF");
  });

  it("sin campaña no dibuja nada", () => {
    expect(renderToStaticMarkup(<CampaniaFicha producto={{ ...producto, campania: undefined }} />)).toBe("");
  });
});

describe("mostrarFin", () => {
  const ahora = Date.parse("2026-11-26T15:00:00.000Z");
  it("dentro de los 7 días, sí; más lejos, no", () => {
    expect(mostrarFin("2026-12-03T14:00:00.000Z", ahora)).toBe(true);
    expect(mostrarFin("2026-12-03T16:00:00.000Z", ahora)).toBe(false);
  });
  it("sin reloj (servidor), no", () => {
    expect(mostrarFin("2026-11-27T00:00:00.000Z", null)).toBe(false);
  });
});

describe("PestaniaOferta (esquina de la foto de la ficha)", () => {
  it("dice «Oferta −N %» en el resaltado de la piel, sin rojo", () => {
    const html = renderToStaticMarkup(<PestaniaOferta pct={9} />);
    expect(html).toContain("Oferta −9 %");
    expect(html).toContain("bg-highlight");
    expect(html).toContain("uppercase");
    expect(html).not.toMatch(/danger|red-/);
  });
});
