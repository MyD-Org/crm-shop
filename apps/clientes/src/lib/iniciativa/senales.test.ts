import { describe, expect, it } from "vitest";
import {
  BUSQUEDAS_PARA_INVITAR,
  MEMORIA_INICIAL,
  MS_ENTRE_INVITACIONES,
  esCheckout,
  fechaDe,
  memoriaDe,
  procesarEvento,
  puedeInvitar,
  type ContextoIniciativa,
  type EventoIniciativa,
  type MemoriaSesion,
} from "./senales";
import { MENSAJES_AL_CHAT, TEXTOS_TEASER } from "./textos";

const AHORA = 1_900_000_000_000;
const ctx = (extra: Partial<ContextoIniciativa> = {}): ContextoIniciativa => ({
  pathname: "/catalogo",
  disponible: true,
  chatAbierto: false,
  ultimaInvitacion: null,
  ahora: AHORA,
  ...extra,
});
const busqueda = (consulta: string, sinResultados = false): EventoIniciativa => ({ tipo: "busqueda", consulta, sinResultados });

/** Corre varios eventos y devuelve la memoria final y las invitaciones. */
function correr(eventos: EventoIniciativa[], contexto = ctx(), memoria: MemoriaSesion = MEMORIA_INICIAL) {
  const invitaciones = [];
  for (const e of eventos) {
    const r = procesarEvento(memoria, e, contexto);
    memoria = r.memoria;
    if (r.invitacion) invitaciones.push(r.invitacion);
  }
  return { memoria, invitaciones };
}

describe("señal: búsqueda sin resultados", () => {
  it("invita con la frase de la spec y manda la consulta al aceptar", () => {
    const { invitaciones, memoria } = correr([busqueda("lampara para pecera", true)]);
    expect(invitaciones).toEqual([
      {
        senal: "sin-resultados",
        text: TEXTOS_TEASER.sinResultados,
        actionLabel: TEXTOS_TEASER.aceptar,
        dismissLabel: TEXTOS_TEASER.cerrar,
        mensaje: MENSAJES_AL_CHAT.sinResultados("lampara para pecera"),
      },
    ]);
    expect(memoria.mostrada).toBe(true);
  });

  it("no si la página ya invita al asesor en línea (Conversar del sin resultados): la búsqueda igual cuenta", () => {
    const evento: EventoIniciativa = { tipo: "busqueda", consulta: "lampara para pecera", sinResultados: true, conInvitacionEnLinea: true };
    const r = procesarEvento(MEMORIA_INICIAL, evento, ctx());
    expect(r.invitacion).toBeNull();
    expect(r.memoria.busquedas).toEqual(["lampara para pecera"]);
    expect(r.memoria.mostrada).toBe(false);
  });

  it("nunca con una búsqueda con forma de código", () => {
    expect(correr([busqueda("DL-18W", true)]).invitaciones).toEqual([]);
    expect(correr([busqueda("7791234567890", true)]).invitaciones).toEqual([]);
  });
});

describe("señal: varias búsquedas sin agregar al carrito", () => {
  it(`invita a la búsqueda distinta número ${BUSQUEDAS_PARA_INVITAR}, con las tres en el mensaje`, () => {
    const { invitaciones } = correr([busqueda("reflector"), busqueda("reflector patio"), busqueda("aplique exterior")]);
    expect(invitaciones).toHaveLength(1);
    expect(invitaciones[0].senal).toBe("busquedas");
    expect(invitaciones[0].text).toBe(TEXTOS_TEASER.busquedas);
    expect(invitaciones[0].mensaje).toBe(MENSAJES_AL_CHAT.busquedas(["reflector", "reflector patio", "aplique exterior"]));
  });

  it("la misma búsqueda repetida (otra página, otra mayúscula o tilde) no cuenta dos veces", () => {
    const { invitaciones, memoria } = correr([busqueda("Lámpara"), busqueda("lampara"), busqueda("  LAMPARA ")]);
    expect(invitaciones).toEqual([]);
    expect(memoria.busquedas).toEqual(["Lámpara"]);
  });

  it("agregar al carrito reinicia la cuenta", () => {
    const { invitaciones } = correr([busqueda("a uno"), busqueda("a dos"), { tipo: "agregado" }, busqueda("a tres")]);
    expect(invitaciones).toEqual([]);
  });

  it("una búsqueda por código no suma y bloquea la invitación hasta la próxima búsqueda que no lo sea", () => {
    const tras = correr([busqueda("reflector"), busqueda("plafon"), busqueda("DL-18W")]);
    expect(tras.invitaciones).toEqual([]);
    expect(tras.memoria.busquedas).toHaveLength(2);
    expect(tras.memoria.ultimaEsCodigo).toBe(true);
    expect(procesarEvento(tras.memoria, { tipo: "ficha-sin-agregar" }, ctx()).invitacion).toBeNull();
    expect(procesarEvento(tras.memoria, busqueda("tira led"), ctx()).invitacion?.senal).toBe("busquedas");
  });

  it("con la tercera sin resultados gana la señal de sin resultados", () => {
    const { invitaciones } = correr([busqueda("uno x"), busqueda("dos x"), busqueda("tres x", true)]);
    expect(invitaciones.map((i) => i.senal)).toEqual(["sin-resultados"]);
  });
});

describe("señal: tiempo en la ficha", () => {
  it("invita con la frase de la spec", () => {
    const r = procesarEvento(MEMORIA_INICIAL, { tipo: "ficha-sin-agregar" }, ctx({ pathname: "/producto/abc" }));
    expect(r.invitacion).toMatchObject({ senal: "ficha", text: TEXTOS_TEASER.ficha, mensaje: MENSAJES_AL_CHAT.ficha });
  });
});

describe("topes", () => {
  const ficha: EventoIniciativa = { tipo: "ficha-sin-agregar" };

  it("una por sesión", () => {
    const { invitaciones } = correr([busqueda("nada por aca", true), ficha, busqueda("otra sin nada", true)]);
    expect(invitaciones).toHaveLength(1);
  });

  it("como máximo una cada 3 días", () => {
    const hace = (ms: number) => ctx({ ultimaInvitacion: AHORA - ms });
    expect(procesarEvento(MEMORIA_INICIAL, ficha, hace(MS_ENTRE_INVITACIONES - 1)).invitacion).toBeNull();
    expect(procesarEvento(MEMORIA_INICIAL, ficha, hace(MS_ENTRE_INVITACIONES)).invitacion).not.toBeNull();
    // Una fecha en el futuro (reloj cambiado) no bloquea para siempre.
    expect(procesarEvento(MEMORIA_INICIAL, ficha, ctx({ ultimaInvitacion: AHORA + 1000 })).invitacion).not.toBeNull();
  });

  it("nunca con el chat abierto, sin chat, en el checkout ni después de cerrar una", () => {
    expect(puedeInvitar(MEMORIA_INICIAL, ctx({ chatAbierto: true }))).toBe(false);
    expect(puedeInvitar(MEMORIA_INICIAL, ctx({ disponible: false }))).toBe(false);
    expect(puedeInvitar(MEMORIA_INICIAL, ctx({ pathname: "/checkout" }))).toBe(false);
    expect(puedeInvitar(MEMORIA_INICIAL, ctx({ pathname: "/checkout/pago" }))).toBe(false);
    expect(puedeInvitar({ ...MEMORIA_INICIAL, descartada: true }, ctx())).toBe(false);
    expect(puedeInvitar(MEMORIA_INICIAL, ctx())).toBe(true);
  });

  it("sin poder invitar, las búsquedas igual cuentan y la sesión no se marca", () => {
    const { memoria, invitaciones } = correr([busqueda("uno"), busqueda("dos"), busqueda("tres")], ctx({ chatAbierto: true }));
    expect(invitaciones).toEqual([]);
    expect(memoria.busquedas).toHaveLength(3);
    expect(memoria.mostrada).toBe(false);
  });
});

describe("rutas y storage", () => {
  it("esCheckout no confunde otras rutas", () => {
    expect(esCheckout("/checkout")).toBe(true);
    expect(esCheckout("/checkout?paso=2")).toBe(true);
    expect(esCheckout("/checkout-info")).toBe(false);
    expect(esCheckout("/carrito")).toBe(false);
  });

  it("memoria y fecha rotas vuelven al estado inicial", () => {
    expect(memoriaDe(null)).toEqual(MEMORIA_INICIAL);
    expect(memoriaDe("{no es json")).toEqual(MEMORIA_INICIAL);
    expect(memoriaDe(JSON.stringify({ busquedas: ["a", 3], mostrada: "si" }))).toEqual({ ...MEMORIA_INICIAL, busquedas: ["a"] });
    expect(fechaDe("abc")).toBeNull();
    expect(fechaDe("-5")).toBeNull();
    expect(fechaDe(String(AHORA))).toBe(AHORA);
  });
});
