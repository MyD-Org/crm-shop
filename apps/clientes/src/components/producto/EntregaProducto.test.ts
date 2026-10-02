import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EntregaProducto } from "./EntregaProducto";
import { CONFIG_ENVIO_DEFAULT } from "@/lib/envio";
import type { DisponibilidadVista, LocalDisponibilidad } from "@/lib/disponibilidad-textos";

const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const locales: LocalDisponibilidad[] = [
  { slug: "sede-a", nombre: "Local A", direccion: "Calle Ejemplo 1", ciudad: "Ciudad Ejemplo" },
  { slug: "sede-b", nombre: "Local B", direccion: "Calle Ejemplo 2", ciudad: "Ciudad Ejemplo" },
];

const producto = (a: "disponible" | "sin_stock", b: "disponible" | "sin_stock"): DisponibilidadVista =>
  ({
    envio: null,
    retiro: {
      "sede-a": { estado: a, desde: null, demoraDias: null },
      "sede-b": { estado: b, desde: null, demoraDias: null },
    },
  }) as unknown as DisponibilidadVista;

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(EntregaProducto, { configEnvio: CONFIG_ENVIO_DEFAULT, ...props }));

describe("EntregaProducto: retiro elegido en la ficha", () => {
  it("retiro en A con stock: 'Retiro en Local A', su estado y Ver local de ese local primero", () => {
    const h = render({
      disponibilidad: { producto: producto("disponible", "disponible"), locales },
      localElegido: "sede-b",
    });
    const t = texto(h);
    expect(t).toContain("Retiro en Local B");
    expect(t.indexOf("Local B · Disponible hoy")).toBeLessThan(t.indexOf("Local A"));
    expect(h).toContain("data-local-elegido");
  });

  it("sin stock en el elegido: 'No disponible en {local}' y los otros locales siguen visibles", () => {
    const h = render({
      disponibilidad: { producto: producto("sin_stock", "disponible"), locales },
      localElegido: "sede-a",
    });
    const t = texto(h);
    expect(t).toContain("Retiro en Local A");
    expect(t).toContain("No disponible en Local A");
    expect(t).toContain("Local B · Disponible hoy");
  });

  it("sin local elegido: título y orden de siempre (por conveniencia)", () => {
    const h = render({ disponibilidad: { producto: producto("sin_stock", "disponible"), locales } });
    const t = texto(h);
    expect(t).toContain("Retiro gratis en el local");
    expect(t.indexOf("Local B")).toBeLessThan(t.indexOf("Local A"));
    expect(h).not.toContain("data-local-elegido");
  });

  it("con retiro elegido, la fila 'Envío a domicilio' sigue la regla general", () => {
    const h = render({
      disponibilidad: { producto: producto("disponible", "disponible"), locales },
      localElegido: "sede-a",
    });
    expect(texto(h)).toContain("Envío a domicilio");
  });
});
