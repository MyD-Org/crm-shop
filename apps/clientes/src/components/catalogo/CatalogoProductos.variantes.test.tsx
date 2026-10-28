import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Product } from "@/data/products";

/**
 * Cards del catálogo con el flag `variantes-selector`: UNA card por modelo, con "Desde $X" cuando los
 * precios de sus opciones difieren, y un botón «Agregar» que abre el panel para elegir la opción (no
 * agrega directo ni navega).
 */

vi.mock("@/components/AddToCartButton", () => ({ AddToCartButton: () => <button data-testid="agregar">Agregar</button> }));
vi.mock("@/components/BotonFavorito", () => ({ BotonFavorito: () => null }));
vi.mock("@/components/BotonCompartir", () => ({ BotonCompartir: () => null }));
// El panel (Dialog por portal, pide las opciones al abrirse) se prueba aparte.
vi.mock("./PanelOpciones", () => ({ PanelOpciones: () => null }));

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
  it("modelo con precios distintos: 'Desde' el menor, la cantidad de opciones y «Agregar» que abre el panel", () => {
    const out = html([prod("1", { variantes: { cantidad: 3, desde: 100 } })]);
    expect(out).toContain("Desde este precio · 3 opciones");
    expect(out).toContain("100");
    expect(out).not.toContain("121");
    expect(out).not.toContain('data-testid="agregar"');
  });

  it("modelo con el mismo precio en todas las opciones: precio normal y '3 opciones'", () => {
    const out = html([prod("1", { variantes: { cantidad: 3 } })]);
    expect(out).toContain("3 opciones");
    expect(out).toContain("aria-haspopup=\"dialog\"");
    expect(out).not.toContain("Desde este precio");
    expect(out).toContain("121");
    expect(out).not.toContain('data-testid="agregar"');
  });

  it("producto suelto: la card de siempre, con su botón de agregar", () => {
    const out = html([prod("2")]);
    expect(out).not.toContain("opciones");
    expect(out).toContain('data-testid="agregar"');
  });

  it("card a pedido: botón habilitado y texto de la modalidad; agotada sin modalidad: deshabilitada", () => {
    const aPedido = html([
      prod("3", { stock: "out", stockQty: 0, ventaSinStock: { id: "m1", texto: "Retiro en ~48 h", plazoDias: 2, flujo: "en_linea" } }),
    ]);
    expect(aPedido).toContain("Retiro en ~48 h");
    expect(aPedido).not.toContain("Sin stock");
    const agotada = html([prod("4", { stock: "out", stockQty: 0 })]);
    expect(agotada).toContain("Sin stock");
  });

  it("la card enlaza a la ficha de la representante", () => {
    const out = html([prod("mdp:7", { variantes: { cantidad: 2 } })]);
    expect(out).toContain('href="/producto/mdp:7"');
  });

  it("nombra las opciones en la card (hasta 3, y '+N' con el resto)", () => {
    const out = html([prod("1", { variantes: { cantidad: 5, etiquetas: ["Blanco frío", "Blanco cálido", "Neutro"] } })]);
    expect(out).toContain("Blanco frío · Blanco cálido · Neutro +2");
    expect(out).not.toContain("5 opciones");
  });

  it("el botón del modelo dice «Agregar», es un botón (no un enlace) y ya no ofrece «Elegir opción»", () => {
    const out = html([prod("1", { variantes: { cantidad: 2 } })]);
    expect(out).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*>[\s\S]*Agregar<\/button>/);
    expect(out).not.toContain("Elegir opción");
  });
});
