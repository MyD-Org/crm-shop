import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CampaniaProducto, Product } from "@/data/products";
import { badgeCampania } from "./PromoProvider";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// Reloj fijo: 26/11/2026 12:00 (Argentina). BF termina el 30/11 23:59, a 4 días.
const reloj = vi.hoisted(() => ({ ahora: Date.parse("2026-11-26T15:00:00.000Z") as number | null }));
vi.mock("./reloj", () => ({ useAhora: () => reloj.ahora }));
const { CampaniaFicha, mostrarFin } = await import("./CampaniaFicha");

// Campañas de precios en cards y ficha (spec 2026-10-28-campanias-precios-design.md). Datos inventados.

const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const BF: CampaniaProducto = { id: "c1", nombre: "Black Friday", etiqueta: "BF", fin: "2026-12-01T02:59:00.000Z", pct: 20, unidades: null, quedan: null };
const producto = { id: "7", name: "Lámpara", price: 128, precioFinal: 154.88, oldPrice: 193.6, stock: "in", campania: BF } as unknown as Product;

describe("badgeCampania (cards)", () => {
  it("la etiqueta y el % en verde, nunca en rojo", () => {
    const html = renderToStaticMarkup(<>{badgeCampania(BF)}</>);
    expect(texto(html)).toContain("BF");
    expect(texto(html)).toContain("20 % de descuento");
    expect(html).toContain("text-success");
    expect(html).not.toContain("text-danger");
  });
});

describe("CampaniaFicha", () => {
  it("badge, el normal tachado con el % y la pastilla con el fin", () => {
    const t = texto(renderToStaticMarkup(<CampaniaFicha producto={producto} />));
    expect(t).toContain("BF");
    expect(t).toContain("Precio habitual");
    expect(t).toContain("20 % de descuento");
    expect(t).toContain("Termina el 30/11");
  });

  it("campaña larga: no anuncia el fin ni la cuenta regresiva", () => {
    const lejana = { ...BF, fin: "2027-06-30T02:59:00.000Z" };
    const t = texto(renderToStaticMarkup(<CampaniaFicha producto={{ ...producto, campania: lejana }} />));
    expect(t).toContain("20 % de descuento");
    expect(t).not.toContain("Termina");
  });

  it("«Hasta agotar stock»: lo dice en lugar del fin y sin cuenta regresiva, aunque falten pocos días", () => {
    const html = renderToStaticMarkup(<CampaniaFicha producto={{ ...producto, campania: { ...BF, hastaAgotarStock: true } }} />);
    const t = texto(html);
    expect(t).toContain("Hasta agotar stock");
    expect(t).toContain("20 % de descuento");
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
