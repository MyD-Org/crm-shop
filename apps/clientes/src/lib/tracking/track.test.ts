import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventoTracking } from "./eventos";
import { activarTracking, reiniciarTracking, track } from "./track";

const evento: EventoTracking = {
  tipo: "agregar_carrito",
  items: [{ id: "p1", nombre: "Lámpara", precio: 100, cantidad: 1 }],
};

function enRuta(pathname: string, query = "") {
  vi.stubGlobal("window", { location: { pathname, href: `https://tienda.example${pathname}${query}` } });
}

describe("track", () => {
  beforeEach(() => {
    reiniciarTracking();
    enRuta("/producto/1", "?i=secreto&utm_source=ig");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("encola hasta que se activa, y ahí manda a los tres proveedores", () => {
    const fbq = vi.fn();
    const gtag = vi.fn();
    const capture = vi.fn();
    track(evento);
    expect(fbq).not.toHaveBeenCalled();

    activarTracking({ fbq, gtag, posthog: { capture } });
    expect(fbq).toHaveBeenCalledWith("track", "AddToCart", expect.objectContaining({ value: 100 }), undefined);
    expect(gtag).toHaveBeenCalledWith("set", { page_location: "https://tienda.example/producto/1?utm_source=ig" });
    expect(gtag).toHaveBeenCalledWith("event", "add_to_cart", expect.objectContaining({ currency: "ARS" }));
    expect(capture).toHaveBeenCalledWith("agregar_carrito", expect.objectContaining({ valor: 100 }));

    track(evento);
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("los eventos de la búsqueda van sólo a PostHog (no son de ecommerce)", () => {
    const fbq = vi.fn();
    const gtag = vi.fn();
    const capture = vi.fn();
    activarTracking({ fbq, gtag, posthog: { capture } });
    track({ tipo: "busqueda_chip_quitado", chip: "categoria", valor: "Reflectores" });
    track({ tipo: "busqueda_conversar", origen: "pregunta" });
    track({ tipo: "busqueda_filtro_car", clave: "polos", accion: "agregar", valor: "2" });
    expect(fbq).not.toHaveBeenCalled();
    expect(gtag).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledWith("busqueda_chip_quitado", { tipo: "categoria", valor: "Reflectores" });
    expect(capture).toHaveBeenCalledWith("busqueda_conversar", { origen: "pregunta" });
    expect(capture).toHaveBeenCalledWith("busqueda_filtro_car", { clave: "polos", accion: "agregar", valor: "2" });
  });

  it("sin activar (flag apagado) no sale nada y la cola no crece sin límite", () => {
    for (let i = 0; i < 100; i++) track(evento);
    const capture = vi.fn();
    activarTracking({ posthog: { capture } });
    expect(capture).toHaveBeenCalledTimes(20);
  });

  it("en login y registro no manda nada", () => {
    const capture = vi.fn();
    activarTracking({ posthog: { capture } });
    enRuta("/ingresar");
    track(evento);
    expect(capture).not.toHaveBeenCalled();
  });

  it("un proveedor que tira no corta a los demás ni al que llama", () => {
    const capture = vi.fn();
    activarTracking({
      fbq: () => {
        throw new Error("bloqueado");
      },
      posthog: { capture },
    });
    expect(() => track(evento)).not.toThrow();
    expect(capture).toHaveBeenCalledOnce();
  });

  it("en el server es no-op", () => {
    vi.unstubAllGlobals();
    expect(() => track(evento)).not.toThrow();
  });
});
