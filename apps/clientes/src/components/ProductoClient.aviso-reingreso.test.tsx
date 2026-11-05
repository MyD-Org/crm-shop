import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Product } from "@/data/products";

/**
 * Ficha con el flag `aviso-reingreso`: el botón "Avisarme cuando ingrese" aparece solo en un producto
 * agotado, comprable e inventariable. Se renderiza en el servidor, sin DOM (como las otras pruebas de la
 * ficha); el formulario se reemplaza por una marca porque su comportamiento se prueba en la acción.
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
vi.mock("@/components/AvisoReingresoForm", () => ({
  AvisoReingresoForm: ({ alegraId }: { alegraId: string }) => <div data-testid="aviso-form" data-id={alegraId} />,
}));

import { ProductoClient } from "./ProductoClient";

const prod = (over: Partial<Product>): Product => ({
  id: "11",
  name: "Cinta LED 5050",
  brand: "",
  price: 100,
  precioFinal: 121,
  stock: "out",
  stockQty: 0,
  sku: "COD-11",
  ...over,
});

const ficha = (producto: Product, avisoReingreso?: boolean) =>
  renderToStaticMarkup(<ProductoClient producto={producto} avisoReingreso={avisoReingreso} />);

describe("ProductoClient con aviso de reingreso", () => {
  it("agotado con el flag ON: ofrece el aviso con el id del producto", () => {
    const html = ficha(prod({}), true);
    expect(html).toContain('data-testid="aviso-form"');
    expect(html).toContain('data-id="11"');
  });

  it("flag OFF (o sin la prop): solo 'Sin stock', como siempre", () => {
    expect(ficha(prod({}), false)).not.toContain("aviso-form");
    const html = ficha(prod({}));
    expect(html).not.toContain("aviso-form");
    expect(html).toContain("Sin stock");
  });

  it("con stock: no ofrece el aviso", () => {
    expect(ficha(prod({ stock: "in", stockQty: 10 }), true)).not.toContain("aviso-form");
    expect(ficha(prod({ stock: "low", stockQty: 2 }), true)).not.toContain("aviso-form");
  });

  it("no inventariable (stock NULL): nunca ofrece el aviso", () => {
    expect(ficha(prod({ stock: "in", stockQty: undefined }), true)).not.toContain("aviso-form");
  });

  it("sin precio: no ofrece el aviso", () => {
    expect(ficha(prod({ price: 0, precioFinal: undefined }), true)).not.toContain("aviso-form");
  });

  it("con selector de variantes: el aviso es de la variante elegida y desaparece si tiene stock", () => {
    const rojo = prod({ id: "11" });
    const verde = prod({ id: "12", stock: "in", stockQty: 10 });
    const opciones = [
      { id: "11", etiqueta: "Rojo", producto: rojo },
      { id: "12", etiqueta: "Verde", producto: verde },
    ];
    const grupo = { representanteId: "11", opciones };
    const conRojo = renderToStaticMarkup(<ProductoClient producto={{ ...rojo, grupo }} avisoReingreso />);
    expect(conRojo).toContain('data-id="11"');
    const conVerde = renderToStaticMarkup(<ProductoClient producto={{ ...verde, grupo }} avisoReingreso />);
    expect(conVerde).not.toContain("aviso-form");
  });
});
