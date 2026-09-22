import { afterEach, describe, expect, it, vi } from "vitest";
import { pagosHabilitados } from "./pagos-flag";

/**
 * El Shop nace con los medios de pago APAGADOS: el pedido se confirma con
 * "a coordinar" y un asesor cierra el pago por fuera. Un valor mal tipeado en
 * el env ("true", " 1") tiene que dejarlo apagado, no encender cobros a medias.
 */
describe("pagosHabilitados", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("apagado por defecto", () => {
    vi.stubEnv("PAGOS_ENABLED", undefined as unknown as string);
    expect(pagosHabilitados()).toBe(false);
  });

  it("sólo el string exacto '1' lo enciende", () => {
    vi.stubEnv("PAGOS_ENABLED", "1");
    expect(pagosHabilitados()).toBe(true);
  });

  it.each(["", "0", "true", "TRUE", " 1", "1 ", "yes"])(
    "%j lo deja apagado",
    (v) => {
      vi.stubEnv("PAGOS_ENABLED", v);
      expect(pagosHabilitados()).toBe(false);
    },
  );
});
