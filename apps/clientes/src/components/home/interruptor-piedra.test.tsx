import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "@myd-org/ui";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/home-acciones", () => ({
  guardarDecoracion: vi.fn(),
  guardarOrdenHome: vi.fn(),
  guardarSeccion: vi.fn(),
  leerSeccionParaEditar: vi.fn(),
  cambiarVisibilidadSeccion: vi.fn(),
  guardarDatosLegales: vi.fn(),
  guardarFooter: vi.fn(),
  restablecerFooter: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { DEFAULTS_HOME } from "@/data/home-defaults";
import { DEFAULTS_FOOTER } from "@/data/footer";
import { BarraEdicion } from "./BarraEdicion";
import { InterruptorPiedra } from "./InterruptorPiedra";

const conToasts = (el: ReactElement) => createElement(ToastProvider, null, el);

describe("interruptor de la textura de piedra", () => {
  it("se ofrece en usted y refleja el estado guardado", () => {
    const apagado = renderToStaticMarkup(conToasts(createElement(InterruptorPiedra, { inicial: false })));
    const prendido = renderToStaticMarkup(conToasts(createElement(InterruptorPiedra, { inicial: true })));
    expect(apagado).toContain("Usar la textura de piedra en la tienda");
    expect(apagado).not.toBe(prendido);
  });

  it("la barra de edición lo trae con el valor guardado del sitio", () => {
    const barra = (piedra: boolean) =>
      renderToStaticMarkup(
        conToasts(
          createElement(BarraEdicion, {
            visibilidad: {},
            orden: [...DEFAULTS_HOME.orden],
            legal: {},
            footer: DEFAULTS_FOOTER,
            piedra,
          }),
        ),
      );
    expect(barra(false)).toContain("Usar la textura de piedra en la tienda");
    expect(barra(true)).not.toBe(barra(false));
  });
});
