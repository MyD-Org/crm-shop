import { describe, expect, it } from "vitest";
import {
  desafio3DS,
  esPendienteConocido,
  estadoDeMercadoPago,
  motivoDeMercadoPago,
} from "./mercadopago-estados";
import { MENSAJE_RECHAZO, convieneReintentar, type MotivoRechazo } from "./tipos";

/**
 * Esta traducción decide dos cosas caras: si un pedido se marca cobrado, y qué
 * le decimos al cliente cuando le rechazan la tarjeta. La primera es plata; la
 * segunda es la diferencia entre recuperar una venta y perderla.
 */

describe("estadoDeMercadoPago", () => {
  it("solo aprueba lo explícitamente aprobado", () => {
    expect(estadoDeMercadoPago("approved")).toBe("pagado");
    expect(estadoDeMercadoPago("authorized")).toBe("pagado");
  });

  it("marca fallido lo rechazado y lo cancelado", () => {
    expect(estadoDeMercadoPago("rejected")).toBe("fallido");
    expect(estadoDeMercadoPago("cancelled")).toBe("fallido");
  });

  it("deja pendiente lo que está en curso", () => {
    expect(estadoDeMercadoPago("in_process")).toBe("pendiente");
    expect(estadoDeMercadoPago("pending")).toBe("pendiente");
  });

  /**
   * Lo más importante del módulo. Un estado que MP agregue mañana, o una
   * respuesta rara, NO puede caer en "fallido": eso cancelaría la compra de
   * alguien que quizás sí pagó. Pendiente es el default seguro — un humano lo
   * mira, y el webhook lo corrige cuando MP resuelva.
   */
  it("un estado desconocido queda PENDIENTE, nunca fallido", () => {
    for (const raro of ["algo_nuevo", "", undefined, "APPROVED", "refunded"]) {
      expect(estadoDeMercadoPago(raro), String(raro)).toBe("pendiente");
    }
  });
});

describe("motivoDeMercadoPago", () => {
  it("no devuelve motivo si el pago no está rechazado", () => {
    expect(motivoDeMercadoPago("approved", "accredited")).toBeUndefined();
    expect(motivoDeMercadoPago("in_process", "pending_contingency")).toBeUndefined();
  });

  it("traduce los rechazos que se arreglan reescribiendo la tarjeta", () => {
    for (const codigo of [
      "cc_rejected_bad_filled_card_number",
      "cc_rejected_bad_filled_date",
      "cc_rejected_bad_filled_security_code",
      "cc_rejected_bad_filled_other",
    ]) {
      expect(motivoDeMercadoPago("rejected", codigo), codigo).toBe("datos_invalidos");
    }
  });

  it("distingue fondos, límite y cuotas, que se resuelven distinto", () => {
    expect(motivoDeMercadoPago("rejected", "cc_rejected_insufficient_amount")).toBe("fondos");
    expect(motivoDeMercadoPago("rejected", "cc_amount_rate_limit_exceeded")).toBe("limite");
    expect(motivoDeMercadoPago("rejected", "cc_rejected_invalid_installments")).toBe(
      "cuotas_no_disponibles",
    );
  });

  it("separa los casos que exigen llamar al banco", () => {
    expect(motivoDeMercadoPago("rejected", "cc_rejected_call_for_authorize")).toBe(
      "requiere_autorizacion",
    );
    expect(motivoDeMercadoPago("rejected", "cc_rejected_card_disabled")).toBe(
      "tarjeta_inhabilitada",
    );
  });

  it("marca los casos donde reintentar es lo peor", () => {
    expect(motivoDeMercadoPago("rejected", "cc_rejected_duplicated_payment")).toBe("duplicado");
    expect(motivoDeMercadoPago("rejected", "cc_rejected_max_attempts")).toBe(
      "demasiados_intentos",
    );
  });

  it("agrupa el antifraude bajo riesgo", () => {
    expect(motivoDeMercadoPago("rejected", "cc_rejected_high_risk")).toBe("riesgo");
    expect(motivoDeMercadoPago("rejected", "cc_rejected_blacklist")).toBe("riesgo");
  });

  it("un código nuevo de MP cae en desconocido, no rompe", () => {
    expect(motivoDeMercadoPago("rejected", "cc_rejected_algo_que_no_existe")).toBe("desconocido");
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
  });
});

describe("convieneReintentar", () => {
  it("deja reintentar solo lo que se arregla en el formulario", () => {
    expect(convieneReintentar("datos_invalidos")).toBe(true);
    expect(convieneReintentar("cuotas_no_disponibles")).toBe(true);
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
      "duplicado",
      "demasiados_intentos",
      "riesgo",
    ] as MotivoRechazo[]) {
      expect(convieneReintentar(m), m).toBe(false);
    }
  });
});

describe("desafio3DS", () => {
  it("devuelve el desafío cuando está completo", () => {
    expect(
      desafio3DS({
        status: "pending",
        status_detail: "pending_challenge",
        three_ds_info: { external_resource_url: "https://banco.test/acs", creq: "abc123" },
      }),
    ).toEqual({ externalResourceUrl: "https://banco.test/acs", creq: "abc123" });
  });

  /**
   * Un desafío a medias haría fallar al Status Screen Brick en pantalla, que es
   * peor que no ofrecerlo: el cliente se queda sin pago Y sin explicación.
   */
  it("no devuelve nada si falta alguno de los dos campos", () => {
    expect(
      desafio3DS({
        status_detail: "pending_challenge",
        three_ds_info: { external_resource_url: "https://banco.test/acs" },
      }),
    ).toBeUndefined();
    expect(
      desafio3DS({ status_detail: "pending_challenge", three_ds_info: { creq: "abc" } }),
    ).toBeUndefined();
    expect(desafio3DS({ status_detail: "pending_challenge" })).toBeUndefined();
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

describe("esPendienteConocido", () => {
  it("reconoce los pendientes documentados", () => {
    expect(esPendienteConocido("pending_challenge")).toBe(true);
    expect(esPendienteConocido("pending_review_manual")).toBe(true);
  });

  it("no reconoce cualquier cosa", () => {
    expect(esPendienteConocido("accredited")).toBe(false);
    expect(esPendienteConocido(undefined)).toBe(false);
  });
});
