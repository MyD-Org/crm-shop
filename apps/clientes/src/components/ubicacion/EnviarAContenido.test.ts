import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EnviarAContenido } from "./EnviarAContenido";

const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const render = (lineas: { retiro: boolean; etiqueta: string; valor: string }) =>
  renderToStaticMarkup(createElement(EnviarAContenido, { lineas }));

describe("EnviarAContenido (dos líneas del header)", () => {
  it("en línea (mobile, bajo el buscador): etiqueta y valor en la misma fila", () => {
    const h = renderToStaticMarkup(
      createElement(EnviarAContenido, { lineas: { retiro: true, etiqueta: "Retirar en", valor: "Local A" }, enLinea: true }),
    );
    expect(texto(h)).toBe("Retirar en Local A");
    expect(h).not.toContain("flex-col");
  });

  it("envío: etiqueta arriba, valor abajo, con pin y sin ícono de local", () => {
    const h = render({ retiro: false, etiqueta: "Enviar a Ana", valor: "Calle Ejemplo 123" });
    expect(texto(h)).toBe("Enviar a Ana Calle Ejemplo 123");
    expect(h).toContain('data-icono="pin"');
    expect(h).not.toContain('data-icono="local"');
  });

  it("retiro: ícono de local + Retirar en / {local}", () => {
    const h = render({ retiro: true, etiqueta: "Retirar en", valor: "Local A" });
    expect(texto(h)).toBe("Retirar en Local A");
    expect(h).toContain('data-icono="local"');
  });

  it("la segunda línea se trunca con elipsis (sin salto) y el bloque mide dos líneas de leading-4 (h-8)", () => {
    const h = render({ retiro: false, etiqueta: "Enviar a", valor: "Una calle con un nombre larguísimo 12345" });
    expect(h).toMatch(/class="[^"]*\btruncate\b[^"]*"[^>]*>Una calle/);
    expect((h.match(/leading-4/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("UbicacionHeader y SelectorUbicacion (guardas de fuente)", () => {
  const header = readFileSync(join(__dirname, "UbicacionHeader.tsx"), "utf8");
  const selector = readFileSync(join(__dirname, "SelectorUbicacion.tsx"), "utf8");

  it("el fallback del Suspense reserva el alto de dos líneas (h-8) o de una en mobile (h-4), sin CLS", () => {
    expect(header).toMatch(/const ALTO = "h-8"/);
    expect(header).toMatch(/const ALTO_EN_LINEA = "h-4"/);
    expect(header).toContain("<Suspense fallback={<div aria-hidden className={enLinea ? ALTO_EN_LINEA : ALTO} />}>");
  });

  it("la cookie y la identidad se leen dentro del hueco por request; el header no carga direcciones", () => {
    expect(header).toContain("await connection();");
    expect(header).toContain("ubicacionDelVisitante()");
    expect(header).toContain("lineasEnviarA(");
    expect(header).not.toContain("listarDirecciones");
    expect(header).not.toContain("/api/mi-cuenta/direcciones");
  });

  it("el modal se carga recién al primer click (next/dynamic sin SSR)", () => {
    expect(selector).toContain('from "next/dynamic"');
    expect(selector).toMatch(/dynamic\(\s*\(\)\s*=>\s*import\("\.\/ModalEnviarA"\)/);
    expect(selector).toContain("ssr: false");
    expect(selector).not.toMatch(/^import .*ModalEnviarA/m);
  });
});
