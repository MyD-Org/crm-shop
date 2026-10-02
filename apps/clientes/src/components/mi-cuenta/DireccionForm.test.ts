import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FORMULARIO_VACIO } from "@/lib/direcciones-envio-cliente";
import { DireccionForm } from "./DireccionForm";

const base = {
  titulo: "Nueva dirección",
  inicial: FORMULARIO_VACIO,
  facturacion: null,
  ofrecerFacturacion: false,
  esPredeterminada: false,
  guardando: false,
  error: null as string | null,
  errores: {},
  onGuardar: () => {},
  onCancelar: () => {},
};

const html = (props: Partial<Parameters<typeof DireccionForm>[0]> = {}) =>
  renderToStaticMarkup(createElement(DireccionForm, { ...base, ...props }));

describe("DireccionForm", () => {
  it("por defecto (Mi cuenta): dentro de una Card con título, a dos columnas, botón Cancelar", () => {
    const h = html();
    expect(h).toContain("sm:col-span-2");
    expect(h).toContain("<h3");
    expect(h).toContain("Nueva dirección");
    expect(h).toContain("Cancelar");
    expect(h).not.toContain(">Volver<");
  });

  it("variante embebida (modal Enviar a): sin Card, sin título propio, sin col-span y con botón Volver", () => {
    const h = html({ variante: "embebida" });
    expect(h).not.toContain("sm:col-span-2");
    expect(h).not.toContain("<h3");
    expect(h).not.toContain("shadow-1");
    expect(h).toContain(">Volver<");
    expect(h).not.toContain(">Cancelar<");
    expect(h).toContain("Guardar dirección");
  });

  it("el error del API (en usted) se ve en la variante embebida", () => {
    const h = html({ variante: "embebida", error: "No pudimos guardar los cambios. Inténtelo de nuevo." });
    expect(h).toContain("No pudimos guardar los cambios. Inténtelo de nuevo.");
  });
});
