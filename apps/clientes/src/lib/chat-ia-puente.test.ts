import { beforeEach, describe, expect, it, vi } from "vitest";
import { leerEstado } from "./catalogo-url";
import {
  LARGO_MAX_PEDIDO,
  contextoParaChat,
  conversar,
  fijarCatalogoParaChat,
  estadoChatIa,
  estadoChatIaServidor,
  pedidoChatIa,
  registrarChatIa,
  reiniciarChatIa,
  suscribirChatIa,
} from "./chat-ia-puente";

beforeEach(() => reiniciarChatIa());

describe("puente con el chat", () => {
  it("sin chat registrado no está disponible y conversar no hace nada", () => {
    expect(estadoChatIa()).toEqual({ disponible: false, pedido: null, teaser: null });
    expect(conversar("luz para el patio")).toBe(false);
    expect(pedidoChatIa()).toBeNull();
  });

  it("con el chat registrado, cada conversar es un pedido nuevo con la forma de sendRequest", () => {
    const oyente = vi.fn();
    suscribirChatIa(oyente);
    registrarChatIa();
    expect(estadoChatIa().disponible).toBe(true);
    expect(conversar("  luz   para el patio ")).toBe(true);
    const primero = pedidoChatIa();
    expect(primero).toEqual({ id: expect.any(String), text: "luz para el patio" });
    conversar("luz para el patio");
    expect(pedidoChatIa()!.id).not.toBe(primero!.id);
    expect(oyente).toHaveBeenCalledTimes(3);
  });

  it("texto vacío no pide nada; el largo se recorta", () => {
    registrarChatIa();
    expect(conversar("   ")).toBe(false);
    conversar("x".repeat(900));
    expect(pedidoChatIa()!.text).toHaveLength(LARGO_MAX_PEDIDO);
  });

  it("la baja deja de estar disponible cuando se va el último registro (StrictMode monta dos veces)", () => {
    const baja1 = registrarChatIa();
    const baja2 = registrarChatIa();
    baja1();
    baja1();
    expect(estadoChatIa().disponible).toBe(true);
    baja2();
    expect(estadoChatIa()).toEqual({ disponible: false, pedido: null, teaser: null });
  });

  it("en el servidor nunca hay chat", () => {
    registrarChatIa();
    expect(estadoChatIaServidor()).toEqual({ disponible: false, pedido: null, teaser: null });
  });
});

describe("contexto de pantalla para el chat", () => {
  it("el catálogo publicado entra sólo en /catalogo; al desmontarse se va", () => {
    fijarCatalogoParaChat({ estado: leerEstado({ atr: "tono-calido" }), total: 12, productos: [{ id: "1101", name: "Reflector" }] });
    expect(contextoParaChat("/catalogo").catalogo).toMatchObject({ url: "atr=tono-calido", total: 12, primeros: [{ id: "1101", nombre: "Reflector" }] });
    expect(contextoParaChat("/carrito", { carrito: { lineas: 2 } })).toEqual({ v: 1, pagina: "carrito", carrito: { lineas: 2 } });
    fijarCatalogoParaChat(null);
    expect(contextoParaChat("/catalogo")).toEqual({ v: 1, pagina: "catalogo" });
  });
});
