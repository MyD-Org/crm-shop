import { describe, expect, it, vi } from "vitest";
import { NavegacionCatalogo } from "./catalogo-navegacion";

describe("NavegacionCatalogo", () => {
  it("consolida una ráfaga en el último href y conserva una sola entrada de historial", () => {
    vi.useFakeTimers();
    const actualizar = vi.fn();
    const push = vi.fn();
    const replace = vi.fn();
    const navegacion = new NavegacionCatalogo({ actualizar, push, replace, demoraMs: 200 });

    navegacion.programar("/catalogo?marca=A");
    navegacion.programar("/catalogo?marca=A&marca=B");
    navegacion.programar("/catalogo?marca=B");

    expect(push).toHaveBeenCalledExactlyOnceWith("/catalogo?marca=A");
    expect(replace).toHaveBeenCalledTimes(2);
    expect(replace).toHaveBeenLastCalledWith("/catalogo?marca=B");
    expect(actualizar).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);

    expect(actualizar).toHaveBeenCalledExactlyOnceWith("/catalogo?marca=B");
    navegacion.cancelar();
    vi.useRealTimers();
  });

  it("abre una nueva entrada después de enviar el cambio anterior", () => {
    vi.useFakeTimers();
    const actualizar = vi.fn();
    const push = vi.fn();
    const replace = vi.fn();
    const navegacion = new NavegacionCatalogo({ actualizar, push, replace, demoraMs: 200 });

    navegacion.programar("/catalogo?marca=A");
    vi.advanceTimersByTime(200);
    navegacion.programar("/catalogo?marca=B");

    expect(push).toHaveBeenCalledTimes(2);
    expect(replace).not.toHaveBeenCalled();
    navegacion.cancelar();
    vi.useRealTimers();
  });

  it("cancelar evita que un componente desmontado refresque el catálogo", () => {
    vi.useFakeTimers();
    const actualizar = vi.fn();
    const navegacion = new NavegacionCatalogo({
      actualizar,
      push: vi.fn(),
      replace: vi.fn(),
      demoraMs: 200,
    });

    navegacion.programar("/catalogo?marca=A");
    navegacion.cancelar();
    vi.advanceTimersByTime(200);

    expect(actualizar).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
