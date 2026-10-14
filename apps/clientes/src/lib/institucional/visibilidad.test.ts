import { describe, expect, it, vi } from "vitest";
import { columnasFooter } from "@/lib/legales/footer";
import { entradasSitemap } from "@/lib/seo";

const { datosMock, notFoundMock } = vi.hoisted(() => ({
  datosMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/lib/institucional/datos", () => ({ getPaginaInstitucional: datosMock }));
vi.mock("next/navigation", () => ({ notFound: notFoundMock }));
vi.mock("@/components/legales/PaginaLegal", () => ({ PaginaLegal: () => null }));

import PaginaInstitucional, { generateStaticParams } from "../../app/(institucional)/[pagina]/page";

describe("Central Led (sin páginas publicadas): footer y sitemap sin diff", () => {
  it("footer: sin páginas, las columnas son exactamente las de siempre", () => {
    expect(columnasFooter({ arrepentimiento: true, paginas: [] })).toEqual(columnasFooter({ arrepentimiento: true }));
    expect(columnasFooter({ arrepentimiento: true }).map((c) => c.title)).not.toContain("Información");
  });

  it("sitemap: sin páginas, las entradas son exactamente las de siempre", () => {
    expect(entradasSitemap("https://tienda.example", ["a"], [])).toEqual(entradasSitemap("https://tienda.example", ["a"]));
  });

  it("tenant con páginas activas: aparecen en el footer (antes de Legales) y en el sitemap", () => {
    const paginas = [{ label: "Garantía", href: "/garantia" }];
    const cols = columnasFooter({ arrepentimiento: true, paginas });
    const i = cols.findIndex((c) => c.title === "Información");
    expect(cols[i].links).toEqual([{ label: "Garantía", href: "/garantia" }]);
    expect(cols[i + 1].title).toBe("Legales");
    const urls = entradasSitemap("https://tienda.example", [], ["/garantia"]).map((e) => e.url);
    expect(urls).toContain("https://tienda.example/garantia");
  });
});

describe("ruta /[pagina]", () => {
  it("genera solo los 5 slugs", () => {
    expect(generateStaticParams().map((p) => p.pagina).sort()).toEqual(
      ["contacto", "envios-y-devoluciones", "garantia", "nosotros", "preguntas-frecuentes"],
    );
    expect(generateStaticParams().map((p) => p.pagina)).not.toContain("envios-y-pagos");
  });

  it("no publicada (Central Led): notFound()", async () => {
    datosMock.mockResolvedValue(null);
    for (const pagina of ["garantia", "nosotros", "contacto", "preguntas-frecuentes", "envios-y-devoluciones"]) {
      await expect(PaginaInstitucional({ params: Promise.resolve({ pagina }) })).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });

  it("slug desconocido: notFound()", async () => {
    datosMock.mockResolvedValue(null);
    await expect(PaginaInstitucional({ params: Promise.resolve({ pagina: "otra-cosa" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("publicada: renderiza el título y los bloques", async () => {
    datosMock.mockResolvedValue({ slug: "garantia", titulo: "Garantía", bloques: [{ titulo: "A", parrafos: ["b"] }] });
    const el = await PaginaInstitucional({ params: Promise.resolve({ pagina: "garantia" }) });
    expect(el.props).toMatchObject({ titulo: "Garantía", bloques: [{ titulo: "A", parrafos: ["b"] }] });
  });
});
