import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CampaniaProducto, Product } from "@/data/products";
import { badgeCampania } from "./PromoProvider";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { CampaniaFicha } = await import("./CampaniaFicha");

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

  it("con límite de unidades: el texto aprobado de la promo y un punto por unidad (3 libres de 5)", () => {
    const html = renderToStaticMarkup(<CampaniaFicha producto={{ ...producto, campania: { ...BF, unidades: 5, quedan: 3 } }} />);
    expect(texto(html)).toContain("¡Últimas 3 unidades a BF!");
    expect(html.match(/data-unidad="libre"/g)).toHaveLength(3);
    expect(html.match(/data-unidad="vendida"/g)).toHaveLength(2);
  });

  it("agotadas: lo dice y no ofrece unidades", () => {
    const t = texto(renderToStaticMarkup(<CampaniaFicha producto={{ ...producto, campania: { ...BF, unidades: 5, quedan: 0 } }} />));
    expect(t).toContain("Agotadas las unidades a BF");
  });

  it("sin campaña no dibuja nada", () => {
    expect(renderToStaticMarkup(<CampaniaFicha producto={{ ...producto, campania: undefined }} />)).toBe("");
  });
});
