import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Product } from "@/data/products";

/**
 * Cards del catálogo con el flag `variantes-selector`: UNA card por modelo, con "Desde $X" cuando los
 * precios de sus opciones difieren, y sin botón de agregar (la opción se elige en la ficha).
 */

vi.mock("@/components/AddToCartButton", () => ({ AddToCartButton: () => <button data-testid="agregar">Agregar</button> }));
vi.mock("@/components/BotonFavorito", () => ({ BotonFavorito: () => null }));

import { CatalogoProductos } from "./CatalogoProductos";

const prod = (id: string, over: Partial<Product> = {}): Product => ({
  id,
  name: `Cinta LED ${id}`,
  brand: "",
  price: 100,
  precioFinal: 121,
  stock: "in",
  ...over,
});

function html(productos: Product[]) {
  return renderToStaticMarkup(
    <CatalogoProductos productos={productos} vista="grilla" navegando={false} cuotasPorProducto={new Map()} />,
  );
}

describe("CatalogoProductos con modelos de variantes", () => {
  it("modelo con precios distintos: 'Desde' el menor, la cantidad de opciones y sin botón de agregar", () => {
    const out = html([prod("1", { variantes: { cantidad: 3, desde: 100 } })]);
    expect(out).toContain("Desde este precio · 3 opciones");
    expect(out).toContain("100");
    expect(out).not.toContain("121");
    expect(out).not.toContain('data-testid="agregar"');
  });

  it("modelo con el mismo precio en todas las opciones: precio normal y '3 opciones'", () => {
    const out = html([prod("1", { variantes: { cantidad: 3 } })]);
    expect(out).toContain("3 opciones");
    expect(out).not.toContain("Desde este precio");
    expect(out).toContain("121");
    expect(out).not.toContain('data-testid="agregar"');
  });

  it("producto suelto: la card de siempre, con su botón de agregar", () => {
    const out = html([prod("2")]);
    expect(out).not.toContain("opciones");
    expect(out).toContain('data-testid="agregar"');
  });

  it("la card enlaza a la ficha de la representante", () => {
    const out = html([prod("mdp:7", { variantes: { cantidad: 2 } })]);
    expect(out).toContain('href="/producto/mdp:7"');
  });
});
