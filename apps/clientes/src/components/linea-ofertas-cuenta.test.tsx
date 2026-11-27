import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { OfertasCuenta } from "@/lib/ofertas-cuenta";

// A una cuenta con lista propia sin ofertas que le apliquen no se le anuncian ofertas.
const ofertas = vi.hoisted(() => ({ valor: { tipo: "publico" } as OfertasCuenta }));
vi.mock("@/hooks/useOfertasCuenta", () => ({ useOfertasCuenta: () => ofertas.valor }));
const { LineaOfertasCuenta } = await import("./LineaOfertas");
const { OfertasHomeCuenta } = await import("./home/OfertasHomeCuenta");

vi.mock("@/components/ProductosCarrusel", () => ({ ProductosCarrusel: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/TarjetaProductoCarrusel", () => ({ TarjetaProductoCarrusel: ({ producto }: { producto: { name: string } }) => <span>{producto.name}</span> }));

const linea = () => renderToStaticMarkup(<LineaOfertasCuenta texto="Oferta" anuncio={<span>ANUNCIO</span>} />);
const home = () =>
  renderToStaticMarkup(
    <OfertasHomeCuenta productos={[{ id: "1", name: "Prolongador A" }, { id: "2", name: "Prolongador B" }] as never} />,
  );

describe("LineaOfertasCuenta", () => {
  it("público o pendiente: la línea de ofertas", () => {
    for (const v of [{ tipo: "publico" }, { tipo: "pendiente" }] as OfertasCuenta[]) {
      ofertas.valor = v;
      expect(linea()).toContain("Ver ofertas");
    }
  });
  it("lista privada sin ofertas que le apliquen: el anuncio; con alguna, la línea", () => {
    ofertas.valor = { tipo: "privado", ids: new Set() };
    expect(linea()).toContain("ANUNCIO");
    expect(linea()).not.toContain("Ver ofertas");
    ofertas.valor = { tipo: "privado", ids: new Set(["1"]) };
    expect(linea()).toContain("Ver ofertas");
  });
});

describe("OfertasHomeCuenta", () => {
  it("público: todas las ofertas", () => {
    ofertas.valor = { tipo: "publico" };
    expect(home()).toContain("Prolongador A");
    expect(home()).toContain("Prolongador B");
  });
  it("lista privada: sólo las que le aplican; sin ninguna, no hay bloque", () => {
    ofertas.valor = { tipo: "privado", ids: new Set(["2"]) };
    expect(home()).not.toContain("Prolongador A");
    expect(home()).toContain("Prolongador B");
    ofertas.valor = { tipo: "privado", ids: new Set() };
    expect(home()).toBe("");
  });
});
