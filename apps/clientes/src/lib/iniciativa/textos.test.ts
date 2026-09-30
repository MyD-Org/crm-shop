import { describe, expect, it } from "vitest";
import { REGISTRO } from "@/test/registro-usted";
import { MENSAJES_AL_CHAT, TEXTOS_CARRITO_ASESOR, TEXTOS_CUENTENOS, TEXTOS_DUDAS_PRODUCTO, TEXTOS_TEASER } from "./textos";

const valores = (o: object): string[] =>
  Object.values(o).flatMap((v) =>
    typeof v === "function" ? [String(v("ejemplo"))] : typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x) => typeof x === "string") : valores(v),
  );

describe("copy de la iniciativa del asesor", () => {
  it("lo que ve el visitante va en usted: sin voseo ni tuteo", () => {
    const todos = [TEXTOS_DUDAS_PRODUCTO, TEXTOS_CUENTENOS, TEXTOS_CARRITO_ASESOR, TEXTOS_TEASER].flatMap(valores);
    expect(todos.filter((t) => REGISTRO.test(t))).toEqual([]);
  });

  it("las frases del teaser son las de la spec", () => {
    expect(TEXTOS_TEASER.sinResultados).toBe("¿No encontró lo que buscaba? Puedo ayudarle a elegir.");
    expect(TEXTOS_TEASER.busquedas).toBe("¿Le ayudo a encontrarlo más rápido?");
    expect(TEXTOS_TEASER.ficha).toBe("¿Tiene dudas sobre este producto?");
    expect(TEXTOS_TEASER.aceptar).toBe("Sí, ayúdeme");
  });

  it("el mensaje del carrito es el de la spec, tal cual (voz del visitante al asesor)", () => {
    expect(MENSAJES_AL_CHAT.carrito).toBe("Revisá mi carrito y decime si me falta algo para la instalación");
  });

  it("los mensajes con consultas las citan", () => {
    expect(MENSAJES_AL_CHAT.sinResultados("luz patio")).toContain("«luz patio»");
    expect(MENSAJES_AL_CHAT.busquedas(["a", "b"])).toContain("«a», «b»");
  });
});
