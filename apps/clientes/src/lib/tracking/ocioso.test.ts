import { describe, expect, it, vi } from "vitest";
import { cuandoOcioso } from "./ocioso";

function ventana(readyState: DocumentReadyState) {
  const listeners: Record<string, () => void> = {};
  const idles: (() => void)[] = [];
  const w = {
    document: { readyState },
    addEventListener: vi.fn(
      (ev: string, cb: () => void) => (listeners[ev] = cb),
    ),
    removeEventListener: vi.fn(),
    requestIdleCallback: vi.fn((cb: () => void) => idles.push(cb)),
    cancelIdleCallback: vi.fn(),
  };
  return { w: w as unknown as Window, listeners, idles };
}

describe("cuandoOcioso", () => {
  it("con la página cargada, espera a que el navegador esté libre", () => {
    const { w, idles } = ventana("complete");
    const fn = vi.fn();
    cuandoOcioso(fn, w);
    expect(fn).not.toHaveBeenCalled();
    idles[0]();
    expect(fn).toHaveBeenCalledOnce();
  });

  it("si la página no terminó de cargar, espera al load", () => {
    const { w, listeners, idles } = ventana("interactive");
    const fn = vi.fn();
    cuandoOcioso(fn, w);
    expect(idles).toHaveLength(0);
    listeners.load();
    idles[0]();
    expect(fn).toHaveBeenCalledOnce();
  });

  it("cancelado, no corre", () => {
    const { w, idles } = ventana("complete");
    const fn = vi.fn();
    cuandoOcioso(fn, w)();
    idles[0]();
    expect(fn).not.toHaveBeenCalled();
  });
});
