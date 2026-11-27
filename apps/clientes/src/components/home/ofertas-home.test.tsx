import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Product } from "@/data/products";

vi.mock("@/components/TarjetaProductoCarrusel", () => ({
  TarjetaProductoCarrusel: ({ producto }: { producto: Product }) => <div data-card={producto.id}>{producto.name}</div>,
}));
const pagina = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/catalogo-publico", () => ({ paginaOfertasPublica: pagina.fn }));

import { CANTIDAD_OFERTAS_HOME, OfertasHomeVista, TEXTOS_OFERTAS_HOME, ofertasParaHome } from "./OfertasHome";
import { HREF_OFERTAS } from "@/lib/catalogo-url";

const prod = (id: string) => ({ id, name: `Producto ${id}` }) as Product;
const BF = { id: "c1", nombre: "BF", etiqueta: "BF", fin: "2026-12-01T03:00:00.000Z" };
const base = { soloVisibles: true, agrupar: false, disp: undefined, mediosPrecio: undefined };

describe("bloque de ofertas de la home", () => {
  it("sin productos no se dibuja", () => {
    expect(renderToStaticMarkup(<OfertasHomeVista productos={[]} />)).toBe("");
  });

  it("cinta, título, las cards y «Ver todas las ofertas» al catálogo filtrado", () => {
    const html = renderToStaticMarkup(<OfertasHomeVista productos={[prod("1"), prod("2")]} />);
    expect(html).toContain(TEXTOS_OFERTAS_HOME.titulo);
    expect(html).toContain("bg-highlight");
    expect(html).toContain('data-card="1"');
    expect(html).toContain(`href="${HREF_OFERTAS.replace("&", "&amp;")}"`);
    expect(html).toContain(TEXTOS_OFERTAS_HOME.verTodas);
  });

  it("pide las ofertas con las campañas en la clave y recorta al tope; sin campañas no consulta", async () => {
    pagina.fn.mockResolvedValue({ productos: Array.from({ length: 20 }, (_, i) => prod(String(i))) });
    const r = await ofertasParaHome({ ...base, campanias: [BF] });
    expect(r).toHaveLength(CANTIDAD_OFERTAS_HOME);
    expect(pagina.fn).toHaveBeenCalledWith(
      expect.objectContaining({ soloVisibles: true, campanias: [BF] }),
    );
    pagina.fn.mockClear();
    expect(await ofertasParaHome({ ...base, campanias: [] })).toEqual([]);
    expect(pagina.fn).not.toHaveBeenCalled();
  });

  it("si la base falla, ninguna (el bloque no se dibuja y la home sigue)", async () => {
    pagina.fn.mockRejectedValue(new Error("caida"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await ofertasParaHome({ ...base, campanias: [BF] })).toEqual([]);
    error.mockRestore();
  });
});
