import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CONFIG_ENVIO_DEFAULT } from "@/lib/envio";
import type { DisponibilidadVista, LocalDisponibilidad } from "@/lib/disponibilidad-textos";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { EntregaProducto } from "./EntregaProducto";

const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const locales: LocalDisponibilidad[] = [
  { slug: "sede-a", nombre: "Local A", direccion: "Calle Ejemplo 1", ciudad: "Ciudad Ejemplo" },
  { slug: "sede-b", nombre: "Local B", direccion: "Calle Ejemplo 2", ciudad: "Ciudad Ejemplo" },
];

type Est = { estado: "disponible" | "con_demora" | "sin_stock"; demoraDias?: number | null };
const producto = (a: Est, b: Est): DisponibilidadVista =>
  ({
    envio: { estado: "a_traer", demoraDias: 2 },
    retiro: {
      "sede-a": { demoraDias: null, desde: null, ...a },
      "sede-b": { demoraDias: null, desde: null, ...b },
    },
  }) as unknown as DisponibilidadVista;

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(EntregaProducto, { configEnvio: CONFIG_ENVIO_DEFAULT, ...props }));

describe("EntregaProducto: sin elección", () => {
  it("retiro resumido: el mejor estado y Ver locales, sin nombrar locales; envío a domicilio", () => {
    const h = render({
      disponibilidad: { producto: producto({ estado: "sin_stock" }, { estado: "disponible" }), locales },
    });
    const t = texto(h);
    expect(t).toContain("Retiro gratis en el local Disponible hoy Ver locales");
    expect(t).not.toContain("Local A");
    expect(t).not.toContain("Local B");
    expect(t).toContain("Envío a domicilio");
    expect(h).not.toContain("data-entrega");
  });

  it("si ningún local lo tiene hoy, el plazo más corto", () => {
    const t = texto(
      render({
        disponibilidad: {
          producto: producto({ estado: "con_demora", demoraDias: 7 }, { estado: "con_demora", demoraDias: 3 }),
          locales,
        },
      }),
    );
    expect(t).toContain("Disponible en 3 días");
    expect(t).not.toContain("7 días");
  });

  it("con un solo local, su Ver local de siempre", () => {
    const t = texto(
      render({
        disponibilidad: { producto: producto({ estado: "disponible" }, { estado: "disponible" }), locales: [locales[0]] },
      }),
    );
    expect(t).toContain("Ver local");
    expect(t).not.toContain("Ver locales");
  });

  it("en el carrito sigue la lista por local", () => {
    const t = texto(
      render({
        disponibilidad: { producto: producto({ estado: "sin_stock" }, { estado: "disponible" }), locales },
        detallePorLocal: {},
      }),
    );
    expect(t.indexOf("Local B")).toBeLessThan(t.indexOf("Local A"));
  });
});

describe("EntregaProducto: retiro elegido", () => {
  it("'Retiro gratis en {local}' primero, con su estado y Ver local", () => {
    const h = render({
      disponibilidad: { producto: producto({ estado: "con_demora", demoraDias: 7 }, { estado: "con_demora", demoraDias: 7 }), locales },
      localElegido: "sede-b",
    });
    const t = texto(h);
    expect(h).toContain('data-entrega="retiro"');
    expect(t).toContain("Retiro gratis en Local B");
    expect(t).toContain("Ver local");
    expect(t).toContain("Disponible en 7 días");
    expect(t).not.toContain("Cambiar");
    expect(t.indexOf("Retiro gratis en Local B")).toBeLessThan(t.indexOf("También puede pedirlo con envío a domicilio"));
  });

  it("sin stock en el elegido: 'No disponible en {local}'", () => {
    const h = render({
      disponibilidad: { producto: producto({ estado: "sin_stock" }, { estado: "sin_stock" }), locales },
      localElegido: "sede-a",
    });
    expect(texto(h)).toContain("No disponible en Local A");
  });

  it("si otro local lo tiene antes: línea 'Disponible hoy en {otro}' con Cambiar", () => {
    const h = render({
      disponibilidad: { producto: producto({ estado: "con_demora", demoraDias: 7 }, { estado: "disponible" }), locales },
      localElegido: "sede-a",
    });
    const t = texto(h);
    expect(t).toContain("Disponible hoy en Local B");
    expect(t).toContain("Cambiar");
  });

  it("el envío a domicilio queda atenuado, con el despacho de siempre", () => {
    const h = render({
      disponibilidad: { producto: producto({ estado: "disponible" }, { estado: "disponible" }), locales },
      localElegido: "sede-a",
    });
    const t = texto(h);
    expect(t).toContain("También puede pedirlo con envío a domicilio");
    expect(t).toContain("Despacho dentro de 3 días hábiles");
    expect(h).toContain("text-muted");
  });
});

describe("EntregaProducto: envío elegido", () => {
  const props = {
    disponibilidad: { producto: producto({ estado: "con_demora", demoraDias: 4 }, { estado: "disponible" }), locales },
    envioElegido: "Calle Ejemplo 123",
  };

  it("'Envío a {destino}' primero y el retiro resumido como alternativa", () => {
    const h = render(props);
    const t = texto(h);
    expect(h).toContain('data-entrega="envio"');
    expect(t).toContain("Envío a Calle Ejemplo 123");
    expect(t).toContain("O retírelo gratis en el local");
    expect(t.indexOf("Envío a Calle Ejemplo 123")).toBeLessThan(t.indexOf("O retírelo"));
    expect(t).toContain("O retírelo gratis en el local Disponible hoy Ver locales");
  });

  it("no nombra ningún local en la ficha (el detalle va en Ver locales)", () => {
    const t = texto(render(props));
    expect(t).not.toContain("Local A");
    expect(t).not.toContain("Local B");
    expect(t).not.toContain("Ver otros locales");
  });

  it("en el carrito (con detalle por local) no cambia el formato", () => {
    const h = render({ ...props, detallePorLocal: {} });
    expect(h).not.toContain("data-entrega");
  });
});
