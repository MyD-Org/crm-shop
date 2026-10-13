import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Product } from "@/data/products";

/**
 * Contenido del panel «Agregar» de la card: cargando, error y opción elegida. El `Dialog` va por
 * portal (no se renderiza en el servidor), por eso se prueba `CuerpoPanelOpciones`, que es presentacional.
 */
vi.mock("@/context/CartContext", () => ({ useCart: () => ({ addItem: vi.fn() }) }));

import { CuerpoPanelOpciones, PiePanelOpciones, type Carga } from "./PanelOpciones";

const opcion = (id: string, etiqueta: string, over: Partial<Product> = {}): Product => ({
  id,
  name: "Optic 3",
  brand: "Marca",
  price: 100,
  precioFinal: 121,
  stock: "in",
  opcion: etiqueta,
  ...over,
});

const listo = (opciones: Product[]): Carga => ({
  estado: "listo",
  datos: { nombre: "Optic 3", marca: "Marca", representanteId: opciones[0].id, opciones },
});

function html(carga: Carga, elegida: Product | null) {
  return renderToStaticMarkup(
    <CuerpoPanelOpciones
      carga={carga}
      elegida={elegida}
      idDeLaCard="11"
      onElegir={() => {}}
      onReintentar={() => {}}
      onCerrar={() => {}}
    />,
  );
}

describe("CuerpoPanelOpciones", () => {
  const frio = opcion("11", "Blanco frío");
  const calido = opcion("12", "Blanco cálido", { stock: "out", price: 90, precioFinal: 109 });

  it("cargando: marcador accesible, sin selector", () => {
    const out = html({ estado: "cargando" }, null);
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain("Cargando opciones");
    expect(out).not.toContain("radiogroup");
  });

  it("error: mensaje en usted, «Reintentar» y «Ver detalle» a la ficha del producto", () => {
    const out = html({ estado: "error" }, null);
    expect(out).toContain('role="alert"');
    expect(out).toContain("No se pudieron cargar las opciones.");
    expect(out).toContain("Reintentar");
    expect(out).toContain('href="/producto/11"');
    expect(out).toContain("Ver detalle");
  });

  it("opción elegida: precio con impuestos, neto, disponibilidad y selector con las etiquetas", () => {
    const out = html(listo([frio, calido]), frio);
    expect(out).toContain("121");
    expect(out).toContain("precio sin impuestos nacionales");
    expect(out).toContain("En stock");
    expect(out).toContain("Blanco frío");
    expect(out).toContain("Blanco cálido");
    expect(out).toContain('role="radiogroup"');
  });

  it("la opción agotada se anuncia «Sin stock» en el selector y, elegida, en su disponibilidad", () => {
    const out = html(listo([frio, calido]), calido);
    expect(out).toContain("Sin stock");
  });

  it("«Ver detalle» enlaza a la ficha de la opción elegida (id codificado)", () => {
    const mdp = opcion("mdp:12", "Rojo");
    const pie = (elegida: Product | null) =>
      renderToStaticMarkup(
        <PiePanelOpciones elegida={elegida} idDeLaCard="1" deshabilitado={false} onAgregar={() => {}} onCerrar={() => {}} />,
      );
    const out = pie(mdp);
    expect(out).toContain('href="/producto/mdp%3A12"');
    expect(out).toContain("Ver detalle del producto");
    // Las dos acciones van juntas en el pie, la principal primero.
    expect(out.indexOf("Agregar al carrito")).toBeLessThan(out.indexOf("Ver detalle del producto"));
    // Mientras cargan las opciones, el enlace lleva a la ficha de la card.
    expect(pie(null)).toContain('href="/producto/1"');
    // El cuerpo ya no trae un enlace suelto debajo del selector.
    expect(html(listo([frio, mdp]), mdp)).not.toContain("Ver detalle");
  });

  it("precio de la cuenta: se rotula; pendiente: marcador en vez del precio", () => {
    const privado = { ...frio, precioCuenta: "privado" as const, price: 80, precioFinal: 97 };
    expect(html(listo([privado, calido]), privado)).toContain("Precio de su cuenta");
    const pendiente = { ...frio, precioCuenta: "pendiente" as const };
    const out = html(listo([pendiente, calido]), pendiente);
    expect(out).not.toContain("121");
  });

  it("sin precio: texto en usted", () => {
    const sin = { ...frio, price: 0, precioFinal: undefined };
    expect(html(listo([sin, calido]), sin)).toContain("Precio no disponible. Consulte");
  });
});
