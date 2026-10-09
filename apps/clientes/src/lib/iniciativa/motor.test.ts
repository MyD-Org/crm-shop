import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aceptarTeaser,
  descartarTeaser,
  estadoChatIa,
  fijarChatAbierto,
  pedidoChatIa,
  registrarChatIa,
  reiniciarChatIa,
  retirarTeaser,
  teaserChatIa,
} from "../chat-ia-puente";
import { CLAVE_ULTIMA, leerMemoria, reiniciarAlmacen } from "./almacen";
import { anotarBusqueda, anotarEvento } from "./motor";
import { MS_ENTRE_INVITACIONES } from "./senales";
import { MENSAJES_AL_CHAT, TEXTOS_TEASER } from "./textos";

/** Storage en memoria con la forma de la Web Storage API. */
function storage() {
  const datos = new Map<string, string>();
  return {
    datos,
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => void datos.set(k, v),
  };
}

let sesion: ReturnType<typeof storage>;
let local: ReturnType<typeof storage>;

beforeEach(() => {
  reiniciarChatIa();
  reiniciarAlmacen();
  sesion = storage();
  local = storage();
  vi.stubGlobal("sessionStorage", sesion);
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("location", { pathname: "/catalogo" });
});
afterEach(() => vi.unstubAllGlobals());

describe("motor de la invitación + puente", () => {
  it("sin chat no hace nada ni deja rastro en el storage", () => {
    expect(anotarBusqueda("lampara para pecera", true)).toBe(false);
    expect(sesion.datos.size).toBe(0);
    expect(teaserChatIa()).toBeNull();
  });

  it("con chat, la señal publica el teaser con la forma del widget y marca los topes", () => {
    registrarChatIa();
    expect(anotarBusqueda("lampara para pecera", true)).toBe(true);
    expect(teaserChatIa()).toEqual({
      id: expect.stringMatching(/^teaser-sin-resultados-/),
      text: TEXTOS_TEASER.sinResultados,
      actionLabel: TEXTOS_TEASER.aceptar,
      dismissLabel: TEXTOS_TEASER.cerrar,
      mensaje: MENSAJES_AL_CHAT.sinResultados("lampara para pecera"),
    });
    expect(leerMemoria().mostrada).toBe(true);
    expect(Number(local.datos.get(CLAVE_ULTIMA))).toBeGreaterThan(0);
  });

  it("sin teaser si el sin resultados ya muestra Conversar en línea", () => {
    registrarChatIa();
    expect(anotarBusqueda("lampara para pecera", true, true)).toBe(false);
    expect(teaserChatIa()).toBeNull();
    expect(leerMemoria()).toMatchObject({ busquedas: ["lampara para pecera"], mostrada: false });
  });

  it("aceptar abre el chat con el mensaje de la señal y saca el teaser", () => {
    registrarChatIa();
    anotarBusqueda("lampara para pecera", true);
    const { id } = teaserChatIa()!;
    expect(aceptarTeaser("otro-id")).toBe(false);
    expect(aceptarTeaser(id)).toBe(true);
    expect(teaserChatIa()).toBeNull();
    expect(pedidoChatIa()?.text).toBe(MENSAJES_AL_CHAT.sinResultados("lampara para pecera"));
    expect(leerMemoria().descartada).toBe(false);
  });

  it("cerrar lo descarta para la sesión y no manda nada", () => {
    registrarChatIa();
    anotarEvento({ tipo: "ficha-sin-agregar" });
    expect(descartarTeaser(teaserChatIa()!.id)).toBe(true);
    expect(pedidoChatIa()).toBeNull();
    expect(leerMemoria()).toMatchObject({ mostrada: true, descartada: true });
    expect(anotarBusqueda("otra cosa rara", true)).toBe(false);
  });

  it("una por sesión aunque se recargue (sessionStorage) y una cada 3 días entre sesiones (localStorage)", () => {
    registrarChatIa();
    const ahora = Date.now();
    anotarEvento({ tipo: "ficha-sin-agregar" }, ahora);
    retirarTeaser();
    expect(anotarEvento({ tipo: "ficha-sin-agregar" }, ahora + 1000)).toBe(false);

    // Sesión nueva (otra pestaña), mismo navegador.
    sesion.datos.clear();
    reiniciarAlmacen();
    expect(anotarEvento({ tipo: "ficha-sin-agregar" }, ahora + MS_ENTRE_INVITACIONES - 1)).toBe(false);
    expect(anotarEvento({ tipo: "ficha-sin-agregar" }, ahora + MS_ENTRE_INVITACIONES)).toBe(true);
  });

  it("con el chat abierto no invita, y abrirlo retira el teaser sin contarlo como cerrado", () => {
    registrarChatIa();
    fijarChatAbierto(true);
    expect(anotarEvento({ tipo: "ficha-sin-agregar" })).toBe(false);
    expect(leerMemoria().mostrada).toBe(false);
    fijarChatAbierto(false);
    anotarEvento({ tipo: "ficha-sin-agregar" });
    expect(teaserChatIa()).not.toBeNull();
    fijarChatAbierto(true);
    expect(teaserChatIa()).toBeNull();
    expect(leerMemoria().descartada).toBe(false);
  });

  it("en el checkout no invita", () => {
    registrarChatIa();
    vi.stubGlobal("location", { pathname: "/checkout" });
    expect(anotarEvento({ tipo: "ficha-sin-agregar" })).toBe(false);
  });

  it("sin storage (bloqueado) no falla y sigue habiendo una sola por página", () => {
    const roto = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    vi.stubGlobal("sessionStorage", roto);
    vi.stubGlobal("localStorage", roto);
    registrarChatIa();
    expect(anotarEvento({ tipo: "ficha-sin-agregar" })).toBe(true);
    retirarTeaser();
    expect(anotarEvento({ tipo: "ficha-sin-agregar" })).toBe(false);
  });

  it("al darse de baja el chat se va el teaser", () => {
    const baja = registrarChatIa();
    anotarEvento({ tipo: "ficha-sin-agregar" });
    baja();
    expect(estadoChatIa()).toEqual({ disponible: false, abierto: false, orden: null, pedido: null, teaser: null });
  });
});
