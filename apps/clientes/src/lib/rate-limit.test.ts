import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { permitir } from "./rate-limit";

/**
 * El rate limit es lo único que hoy frena tres cosas: la enumeración de CUITs,
 * el barrido de `/api/geocode` que haría banear la IP del servidor contra
 * Nominatim, y la amplificación de `/api/carrito/cotizar` contra Alegra.
 *
 * Las claves llevan un prefijo distinto por test porque el store vive en el
 * módulo y persiste entre tests dentro del mismo archivo.
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("permitir", () => {
  it("deja pasar hasta el máximo y corta después", () => {
    const clave = "tope:usuario";
    expect(permitir(clave, 3, 60_000)).toBe(true);
    expect(permitir(clave, 3, 60_000)).toBe(true);
    expect(permitir(clave, 3, 60_000)).toBe(true);
    expect(permitir(clave, 3, 60_000)).toBe(false);
    expect(permitir(clave, 3, 60_000)).toBe(false);
  });

  it("no consume usos cuando ya cortó", () => {
    const clave = "sin-consumo:usuario";
    permitir(clave, 1, 60_000);
    permitir(clave, 1, 60_000);
    permitir(clave, 1, 60_000);

    // Vencida la ventana debe volver a permitir el máximo completo: los
    // rechazos no pueden haber empujado el contador más allá del tope.
    vi.advanceTimersByTime(60_001);
    expect(permitir(clave, 1, 60_000)).toBe(true);
  });

  it("reabre la ventana cuando vence", () => {
    const clave = "ventana:usuario";
    expect(permitir(clave, 2, 60_000)).toBe(true);
    expect(permitir(clave, 2, 60_000)).toBe(true);
    expect(permitir(clave, 2, 60_000)).toBe(false);

    vi.advanceTimersByTime(59_000);
    expect(permitir(clave, 2, 60_000), "todavía dentro de la ventana").toBe(false);

    vi.advanceTimersByTime(2_000);
    expect(permitir(clave, 2, 60_000), "ventana vencida").toBe(true);
  });

  it("cuenta cada clave por separado", () => {
    expect(permitir("aislado:a", 1, 60_000)).toBe(true);
    expect(permitir("aislado:a", 1, 60_000)).toBe(false);
    // Otro usuario no puede quedar afectado por el tope del primero.
    expect(permitir("aislado:b", 1, 60_000)).toBe(true);
  });

  /**
   * Con máximo 0 no pasa nadie. Sin el chequeo explícito, la rama de "ventana
   * nueva" devuelve `true` antes de mirar el máximo y el primer request se
   * cuela — que es justo el que no debería pasar si alguien configura 0 para
   * apagar un endpoint.
   */
  it("con máximo 0 o negativo no deja pasar ni el primero", () => {
    expect(permitir("cero:usuario", 0, 60_000)).toBe(false);
    expect(permitir("negativo:usuario", -1, 60_000)).toBe(false);
  });
});
