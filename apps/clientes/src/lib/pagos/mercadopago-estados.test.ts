import { describe, expect, it } from "vitest";
import {
  desafio3DS,
  detalleEfectivo,
  esPendienteConocido,
  esReversion,
  estadoDeMercadoPago,
  motivoDeMercadoPago,
  statusEfectivo,
} from "./mercadopago-estados";
import { MENSAJE_RECHAZO, convieneReintentar, type MotivoRechazo } from "./tipos";

/**
 * Esta traducción decide dos cosas caras: si un pedido se marca cobrado, y qué
 * le decimos al comprador cuando le rechazan la tarjeta. La primera es plata; la
 * segunda es la diferencia entre recuperar una venta y perderla.
 *
 * Los códigos son los de Payments API (`/v1/payments`).
 */

describe("estadoDeMercadoPago", () => {
  it("solo `approved` cuenta como pagado", () => {
    expect(estadoDeMercadoPago("approved")).toBe("pagado");
  });

  it("marca fallido lo que dejó la plata fuera de casa", () => {
    for (const s of ["rejected", "cancelled", "refunded", "charged_back"]) {
      expect(estadoDeMercadoPago(s), s).toBe("fallido");
    }
  });

  it("deja pendiente lo que está en curso", () => {
    for (const s of ["pending", "in_process", "in_mediation", "authorized"]) {
      expect(estadoDeMercadoPago(s), s).toBe("pendiente");
    }
  });

  /**
   * Lo más importante del módulo. Un estado que MP agregue mañana NO puede caer
   * en "fallido": eso cancelaría la compra de alguien que quizás sí pagó.
   * Pendiente es el default seguro — un humano lo mira y el webhook lo corrige
   * cuando MP resuelva.
   */
  it("un estado desconocido queda PENDIENTE, nunca fallido", () => {
    for (const raro of ["algo_nuevo", "", undefined, "APPROVED", "processed"]) {
      expect(estadoDeMercadoPago(raro), String(raro)).toBe("pendiente");
    }
  });

  /**
   * `processed` es de la Orders API (la que rechaza credenciales TEST-, y a la
   * que vamos a volver cuando llegue la homologación de MP). No debe colarse
   * como pagado mientras usemos Payments API.
   */
  it("no acepta los estados de la Orders API", () => {
    expect(estadoDeMercadoPago("processed")).toBe("pendiente");
    expect(estadoDeMercadoPago("failed")).toBe("pendiente");
    expect(estadoDeMercadoPago("canceled")).toBe("pendiente");
  });
});

describe("statusEfectivo / detalleEfectivo", () => {
  it("lee el status del pago", () => {
    expect(statusEfectivo({ status: "approved" })).toBe("approved");
    expect(detalleEfectivo({ status_detail: "accredited" })).toBe("accredited");
  });

  it("devuelve undefined si no hay dato", () => {
    expect(statusEfectivo({})).toBeUndefined();
    expect(detalleEfectivo({})).toBeUndefined();
  });
});

describe("motivoDeMercadoPago", () => {
  it("no devuelve motivo si el pago no está caído", () => {
    expect(motivoDeMercadoPago("approved", "accredited")).toBeUndefined();
    expect(motivoDeMercadoPago("in_process", "pending_review_manual")).toBeUndefined();
  });

  it("traduce lo que se arregla reescribiendo la tarjeta", () => {
    expect(motivoDeMercadoPago("rejected", "bad_filled_card_data")).toBe("datos_invalidos");
  });

  it("distingue fondos, límite y cuotas, que se resuelven distinto", () => {
    expect(motivoDeMercadoPago("rejected", "insufficient_amount")).toBe("fondos");
    expect(motivoDeMercadoPago("rejected", "card_insufficient_amount")).toBe("fondos");
    expect(motivoDeMercadoPago("rejected", "amount_limit_exceeded")).toBe("limite");
    expect(motivoDeMercadoPago("rejected", "invalid_installments")).toBe("cuotas_no_disponibles");
  });

  it("separa los casos que exigen llamar al banco", () => {
    expect(motivoDeMercadoPago("rejected", "rejected_by_issuer")).toBe("banco_rechazo");
    expect(motivoDeMercadoPago("rejected", "required_call_for_authorize")).toBe(
      "requiere_autorizacion",
    );
    expect(motivoDeMercadoPago("rejected", "card_disabled")).toBe("tarjeta_inhabilitada");
  });

  it("marca el caso donde reintentar es lo peor", () => {
    expect(motivoDeMercadoPago("rejected", "max_attempts_exceeded")).toBe("demasiados_intentos");
  });

  it("agrupa el antifraude bajo riesgo", () => {
    expect(motivoDeMercadoPago("rejected", "high_risk")).toBe("riesgo");
  });

  /**
   * El desafío vencido se reintenta y listo. Mandarlo a "revisá los datos de tu
   * tarjeta" sería mandarlo a buscar un problema que no existe.
   */
  it("el desafío 3DS vencido tiene motivo propio", () => {
    expect(motivoDeMercadoPago("rejected", "3ds_challenge_expired")).toBe("desafio_vencido");
  });

  it("los errores técnicos caen en desconocido", () => {
    expect(motivoDeMercadoPago("rejected", "invalid_card_token")).toBe("desconocido");
    expect(motivoDeMercadoPago("rejected", "processing_error")).toBe("desconocido");
  });

  it("un código nuevo de MP cae en desconocido, no rompe", () => {
    expect(motivoDeMercadoPago("rejected", "codigo_que_no_existe")).toBe("desconocido");
    expect(motivoDeMercadoPago("rejected", undefined)).toBe("desconocido");
  });
});

describe("mensajes al comprador", () => {
  it("todo motivo tiene mensaje y ninguno queda vacío", () => {
    const motivos = Object.keys(MENSAJE_RECHAZO) as MotivoRechazo[];
    expect(motivos.length).toBeGreaterThan(0);
    for (const m of motivos) {
      expect(MENSAJE_RECHAZO[m]?.trim(), m).toBeTruthy();
    }
  });

  /**
   * El antifraude no se explica: detallar por qué se rechazó es darle un mapa a
   * quien está probando tarjetas robadas.
   */
  it("el mensaje de riesgo no revela el motivo real", () => {
    const texto = MENSAJE_RECHAZO.riesgo.toLowerCase();
    for (const palabra of ["fraude", "riesgo", "sospech", "bloque"]) {
      expect(texto, palabra).not.toContain(palabra);
    }
  });

  it("los motivos accionables dicen qué hacer", () => {
    expect(MENSAJE_RECHAZO.requiere_autorizacion.toLowerCase()).toContain("banco");
    expect(MENSAJE_RECHAZO.tarjeta_inhabilitada.toLowerCase()).toContain("banco");
    expect(MENSAJE_RECHAZO.fondos.toLowerCase()).toContain("otra");
    expect(MENSAJE_RECHAZO.desafio_vencido.toLowerCase()).toContain("banco");
  });

  it("ningún mensaje quedó con caracteres corruptos", () => {
    // Se coló una vez texto en otro alfabeto al editar; que no vuelva a pasar.
    for (const [motivo, texto] of Object.entries(MENSAJE_RECHAZO)) {
      expect(texto, motivo).toMatch(/^[\x20-\x7EáéíóúüñÁÉÍÓÚÜÑ¿¡]+$/);
    }
  });
});

describe("convieneReintentar", () => {
  it("deja reintentar solo lo que se resuelve en el mismo formulario", () => {
    expect(convieneReintentar("datos_invalidos")).toBe(true);
    expect(convieneReintentar("cuotas_no_disponibles")).toBe(true);
    expect(convieneReintentar("desafio_vencido")).toBe(true);
  });

  /**
   * Reintentar con la misma tarjeta cuando el banco pide una llamada solo suma
   * rechazos y baja la tasa de aprobación de la cuenta.
   */
  it("no invita a reintentar lo que necesita otra tarjeta o el banco", () => {
    for (const m of [
      "fondos",
      "limite",
      "banco_rechazo",
      "tarjeta_inhabilitada",
      "requiere_autorizacion",
      "demasiados_intentos",
      "riesgo",
    ] as MotivoRechazo[]) {
      expect(convieneReintentar(m), m).toBe(false);
    }
  });
});

describe("desafio3DS", () => {
  const conDesafio = (info?: Record<string, string>) => ({
    status: "pending",
    status_detail: "pending_challenge",
    three_ds_info: info,
  });

  it("devuelve el desafío cuando está completo", () => {
    expect(
      desafio3DS(conDesafio({ external_resource_url: "https://banco.test/acs", creq: "abc123" })),
    ).toEqual({ externalResourceUrl: "https://banco.test/acs", creq: "abc123" });
  });

  /**
   * Un desafío a medias hace fallar al Status Screen Brick en pantalla, que es
   * peor que no ofrecerlo: el comprador se queda sin pago Y sin explicación.
   */
  it("no devuelve nada si falta alguno de los dos campos", () => {
    expect(desafio3DS(conDesafio({ external_resource_url: "https://banco.test/acs" }))).toBeUndefined();
    expect(desafio3DS(conDesafio({ creq: "abc" }))).toBeUndefined();
    expect(desafio3DS(conDesafio())).toBeUndefined();
  });

  it("no devuelve desafío si el pago no lo está pidiendo", () => {
    expect(
      desafio3DS({
        status: "approved",
        status_detail: "accredited",
        three_ds_info: { external_resource_url: "https://banco.test/acs", creq: "abc" },
      }),
    ).toBeUndefined();
  });
});

describe("esPendienteConocido / esReversion", () => {
  it("reconoce los pendientes documentados", () => {
    expect(esPendienteConocido("pending")).toBe(true);
    expect(esPendienteConocido("in_process")).toBe(true);
    expect(esPendienteConocido("approved")).toBe(false);
    expect(esPendienteConocido(undefined)).toBe(false);
  });

  /**
   * Un contracargo o una devolución son la ÚNICA razón legítima para bajar un
   * pedido de `pagado`. El webhook lo usa para no dejar que un evento
   * desordenado desmarque un pago bueno.
   */
  it("distingue las reversiones de un simple fallo", () => {
    expect(esReversion("charged_back")).toBe(true);
    expect(esReversion("refunded")).toBe(true);
    expect(esReversion("rejected")).toBe(false);
    expect(esReversion("approved")).toBe(false);
  });
});
