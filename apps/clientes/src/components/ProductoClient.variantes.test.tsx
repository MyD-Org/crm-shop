import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { OpcionFicha, Product } from "@/data/products";

/**
 * Ficha de un modelo con variantes (flag `variantes-selector`): el selector, y que lo que se ve
 * (precio, stock, botón) es lo de la opción de la URL. Se renderiza en el servidor, sin DOM: el
 * cambio por clic lo cubre la verificación manual en la Preview.
 */

vi.mock("@/context/CartContext", () => ({ useCart: () => ({ addItem: () => undefined }) }));
vi.mock("@/hooks/usePreciosCuenta", () => ({ usePreciosCuenta: () => new Map() }));
vi.mock("@/components/producto/CuotasConCarrito", () => ({
  CuotasConCarrito: () => null,
  useProgresoCuotasCarrito: () => null,
}));
vi.mock("@/components/BotonFavorito", () => ({ BotonFavorito: () => null }));
vi.mock("@/components/BotonCompartir", () => ({ BotonCompartir: () => null }));
vi.mock("@/components/GaleriaProducto", () => ({ GaleriaProducto: () => null }));
vi.mock("@/components/producto/EntregaProducto", () => ({ EntregaProducto: () => null }));
vi.mock("@/components/producto/DudasProducto", () => ({ DudasProducto: () => null }));
vi.mock("@/components/MediosDePagoModal", () => ({ MediosDePagoModal: () => null }));
vi.mock("@/components/FichaTecnicaModal", () => ({ FichaTecnicaModal: () => null }));

import { ProductoClient } from "./ProductoClient";

const prod = (id: string, over: Partial<Product>): Product => ({
  id,
  name: "Cinta LED 5050",
  brand: "",
  price: 100,
  precioFinal: 121,
  stock: "in",
  sku: `COD-${id}`,
  ...over,
});

const opcion = (id: string, etiqueta: string, over: Partial<Product>): OpcionFicha => ({
  id,
  etiqueta,
  producto: prod(id, over),
});

const rojo = opcion("11", "Rojo", { stock: "out", stockQty: 0, price: 100, precioFinal: 121 });
const verde = opcion("12", "Verde", { stock: "in", stockQty: 10, price: 100, precioFinal: 121 });
const rgb = opcion("13", "RGB", { stock: "low", stockQty: 2, price: 200, precioFinal: 242 });
const opciones = [rgb, rojo, verde];

function ficha(actual: OpcionFicha) {
  return renderToStaticMarkup(
    <ProductoClient
      producto={{ ...actual.producto, grupo: { representanteId: "11", opciones } }}
    />,
  );
}

describe("ProductoClient con selector de variantes", () => {
  it("dibuja un radiogroup 'Opción' con todas las opciones y la de la URL elegida", () => {
    const html = ficha(verde);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain("Opción");
    expect((html.match(/role="radio"/g) ?? []).length).toBe(3);
    expect(html).toMatch(/aria-checked="true"[^>]*>(?:(?!<button).)*Verde/);
  });

  it("muestra el precio y el stock de la opción elegida, no los de la representante", () => {
    const html = ficha(rgb);
    expect(html).toContain("242");
    expect(html).toContain("Últimas unidades");
  });

  it("una opción sin stock se ve con 'Sin stock' y el botón de agregar deshabilitado", () => {
    const html = ficha(rojo);
    // La opción sigue en el selector (seleccionable) con la nota para lectores de pantalla.
    expect(html).toContain("· Sin stock");
    expect(html).not.toMatch(/<button[^>]*role="radio"[^>]*disabled/);
    // Y no se puede comprar.
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Sin stock/);
  });

  it("sin grupo (producto suelto o flag apagado) no hay selector", () => {
    const html = renderToStaticMarkup(<ProductoClient producto={verde.producto} />);
    expect(html).not.toContain('role="radiogroup"');
  });
});
