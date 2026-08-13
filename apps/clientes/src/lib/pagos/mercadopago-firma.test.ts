import { describe, expect, it } from "vitest";
import { firmaValida, firmarParaTest } from "./mercadopago-firma";

/**
 * Esta función es la única puerta del webhook. Si deja pasar algo que no firmó
 * Mercado Pago, cualquiera que conozca la URL puede marcar pedidos como
 * pagados. Los vectores se GENERAN con `firmarParaTest` en vez de pegar un hash
 * a mano: así el test sigue siendo derivable si algo cambia.
 */

const SECRETO = "secreto-de-prueba-de-la-app";
const AHORA_MS = 1_760_000_000_000;
const TS = Math.floor(AHORA_MS / 1000);

function valido(overrides: Partial<Parameters<typeof firmaValida>[0]> = {}) {
  const dataId = "123456789";
  const requestId = "req-abc-123";
  return firmaValida({
    signature: firmarParaTest({ dataId, requestId, tsSegundos: TS, secreto: SECRETO }),
    requestId,
    dataId,
    secreto: SECRETO,
    ahoraMs: AHORA_MS,
    ...overrides,
  });
}

describe("firmaValida — camino feliz", () => {
  it("acepta una notificación bien firmada", () => {
    expect(valido()).toEqual({ valido: true });
  });

  it("tolera espacios y orden invertido en el header", () => {
    const dataId = "123456789";
    const requestId = "req-abc-123";
    const firma = firmarParaTest({ dataId, requestId, tsSegundos: TS, secreto: SECRETO });
    const v1 = firma.split("v1=")[1];

    expect(
      firmaValida({
        signature: ` v1=${v1} , ts=${TS} `,
        requestId,
        dataId,
        secreto: SECRETO,
        ahoraMs: AHORA_MS,
      }),
    ).toEqual({ valido: true });
  });

  it("acepta el v1 en mayúsculas", () => {
    const dataId = "123456789";
    const requestId = "req-abc-123";
    const firma = firmarParaTest({ dataId, requestId, tsSegundos: TS, secreto: SECRETO });

    expect(
      firmaValida({
        signature: firma.toUpperCase().replace("TS=", "ts=").replace("V1=", "v1="),
        requestId,
        dataId,
        secreto: SECRETO,
        ahoraMs: AHORA_MS,
      }),
    ).toEqual({ valido: true });
  });

  /** MP documenta el id alfanumérico en minúsculas. */
  it("normaliza data.id a minúsculas", () => {
    const requestId = "req-abc-123";
    expect(
      firmaValida({
        signature: firmarParaTest({
          dataId: "ABC123",
          requestId,
          tsSegundos: TS,
          secreto: SECRETO,
        }),
        requestId,
        dataId: "ABC123",
        secreto: SECRETO,
        ahoraMs: AHORA_MS,
      }).valido,
    ).toBe(true);
  });
});

describe("firmaValida — rechazos", () => {
  /**
   * EL ATAQUE. Firma legítima de un pago propio, reapuntada al id de otro pago
   * para marcar pagado un pedido ajeno. Tiene que caer.
   */
  it("rechaza una firma válida reapuntada a otro data.id", () => {
    const requestId = "req-abc-123";
    const firmaDeOtroPago = firmarParaTest({
      dataId: "111111111",
      requestId,
      tsSegundos: TS,
      secreto: SECRETO,
    });

    const r = firmaValida({
      signature: firmaDeOtroPago,
      requestId,
      dataId: "999999999", // el pago que el atacante quiere marcar pagado
      secreto: SECRETO,
      ahoraMs: AHORA_MS,
    });
    expect(r.valido).toBe(false);
  });

  it("rechaza con el secreto equivocado", () => {
    expect(valido({ secreto: "otro-secreto" }).valido).toBe(false);
  });

  it("rechaza si cambia el request-id", () => {
    expect(valido({ requestId: "req-distinto" }).valido).toBe(false);
  });

  it("rechaza si cambia el ts sin recalcular el HMAC", () => {
    const dataId = "123456789";
    const requestId = "req-abc-123";
    const firma = firmarParaTest({ dataId, requestId, tsSegundos: TS, secreto: SECRETO });
    const v1 = firma.split("v1=")[1];

    expect(
      firmaValida({
        signature: `ts=${TS + 1},v1=${v1}`,
        requestId,
        dataId,
        secreto: SECRETO,
        ahoraMs: AHORA_MS,
      }).valido,
    ).toBe(false);
  });

  /**
   * Falla CERRADO. Sin secreto configurado no se puede validar nada, y dar por
   * buena la notificación sería exactamente el agujero que esto tapa.
   */
  it("rechaza si falta el secreto, en vez de dejar pasar", () => {
    const r = valido({ secreto: "" });
    expect(r.valido).toBe(false);
    expect(r.valido === false && r.motivo).toContain("MP_WEBHOOK_SECRET");
  });

  it("rechaza cuando faltan headers o data.id", () => {
    expect(valido({ signature: null }).valido).toBe(false);
    expect(valido({ signature: undefined }).valido).toBe(false);
    expect(valido({ requestId: null }).valido).toBe(false);
    expect(valido({ dataId: null }).valido).toBe(false);
  });

  it("rechaza un x-signature mal formado", () => {
    for (const basura of ["", "cualquier cosa", "ts=123", "v1=abc", "ts=,v1=", "=,="]) {
      expect(firmaValida({
        signature: basura,
        requestId: "req-abc-123",
        dataId: "123456789",
        secreto: SECRETO,
        ahoraMs: AHORA_MS,
      }).valido, basura).toBe(false);
    }
  });

  it("rechaza un ts no numérico", () => {
    expect(
      firmaValida({
        signature: "ts=ayer,v1=abc123",
        requestId: "req-abc-123",
        dataId: "123456789",
        secreto: SECRETO,
        ahoraMs: AHORA_MS,
      }).valido,
    ).toBe(false);
  });
});

describe("firmaValida — ventana de tiempo", () => {
  const firmaEn = (tsSegundos: number) => {
    const dataId = "123456789";
    const requestId = "req-abc-123";
    return firmaValida({
      signature: firmarParaTest({ dataId, requestId, tsSegundos, secreto: SECRETO }),
      requestId,
      dataId,
      secreto: SECRETO,
      ahoraMs: AHORA_MS,
    });
  };

  it("acepta dentro de la ventana", () => {
    expect(firmaEn(TS - 30 * 60).valido, "media hora atrás").toBe(true);
  });

  it("rechaza una notificación demasiado vieja", () => {
    expect(firmaEn(TS - 3 * 60 * 60).valido, "tres horas atrás").toBe(false);
  });

  it("rechaza un ts demasiado en el futuro", () => {
    // Un reloj adelantado es un error; un ts muy futuro es alguien fabricando
    // una firma para que no venza nunca.
    expect(firmaEn(TS + 3 * 60 * 60).valido).toBe(false);
  });
});
