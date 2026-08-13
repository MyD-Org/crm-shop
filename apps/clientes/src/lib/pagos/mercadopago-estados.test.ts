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
 * Los códigos son los de la Orders API, no los de /v1/payments.
 */

describe("estadoDeMercadoPago", () => {
  it("solo `processed` cuenta como pagado", () => {
    expect(estadoDeMercadoPago("processed")).toBe("pagado");
  });

  it("marca fallido lo que dejó la plata fuera de casa", () => {
    for (const s of ["failed", "canceled", "expired", "refunded", "charged_back"]) {
      expect(estadoDeMercadoPago(s), s).toBe("fallido");
    }
  });

  it("deja pendiente lo que está en curso", () => {
    for (const s of ["created", "processing", "action_required", "in_review"]) {
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
    for (const raro of ["algo_nuevo", "", undefined, "PROCESSED", "approved"]) {
      expect(estadoDeMercadoPago(raro), String(raro)).toBe("pendiente");
    }
  });

  /** `approved` es de la API vieja: no debe colarse como pagado. */
  it("no acepta los estados de la API legacy", () => {
    expect(estadoDeMercadoPago("approved")).toBe("pendiente");
    expect(estadoDeMercadoPago("rejected")).toBe("pendiente");
  });
});

describe("statusEfectivo / detalleEfectivo", () => {
  it("prefiere el detalle de la transacción sobre el de la orden", () => {
    const orden = {
      status: "failed",
      status_detail: "failed",
      transactions: { payments: [{ status: "failed", status_detail: "insufficient_amount" }] },
    };
    // Una orden `failed` no dice POR QUÉ falló, y ese porqué es lo único que le
    // sirve al comprador.
    expect(statusEfectivo(orden)).toBe("failed");
    expect(detalleEfectivo(orden)).toBe("insufficient_amount");
  });

  it("cae al nivel de orden cuando no hay transacción", () => {
    expect(statusEfectivo({ status: "processed" })).toBe("processed");
    expect(detalleEfectivo({ status_detail: "accredited" })).toBe("accredited");
  });
});

describe("motivoDeMercadoPago", () => {
  it("no devuelve motivo si la orden no está caída", () => {
    expect(motivoDeMercadoPago("processed", "accredited")).toBeUndefined();
    expect(motivoDeMercadoPago("processing", "in_review")).toBeUndefined();
  });

  it("traduce lo que se arregla reescribiendo la tarjeta", () => {
    expect(motivoDeMercadoPago("failed", "bad_filled_card_data")).toBe("datos_invalidos");
  });

  it("distingue fondos, límite y cuotas, que se resuelven distinto", () => {
    expect(motivoDeMercadoPago("failed", "insufficient_amount")).toBe("fondos");
    expect(motivoDeMercadoPago("failed", "card_insufficient_amount")).toBe("fondos");
    expect(motivoDeMercadoPago("failed", "amount_limit_exceeded")).toBe("limite");
    expect(motivoDeMercadoPago("failed", "invalid_installments")).toBe("cuotas_no_disponibles");
  });

  it("separa los casos que exigen llamar al banco", () => {
    expect(motivoDeMercadoPago("failed", "rejected_by_issuer")).toBe("banco_rechazo");
    expect(motivoDeMercadoPago("failed", "required_call_for_authorize")).toBe(
      "requiere_autorizacion",
    );
    expect(motivoDeMercadoPago("failed", "card_disabled")).toBe("tarjeta_inhabilitada");
  });

  it("marca el caso donde reintentar es lo peor", () => {
    expect(motivoDeMercadoPago("failed", "max_attempts_exceeded")).toBe("demasiados_intentos");
  });

  it("agrupa el antifraude bajo riesgo", () => {
    expect(motivoDeMercadoPago("failed", "high_risk")).toBe("riesgo");
  });

  /**
   * El desafío vencido se reintenta y listo. Mandarlo a "revisá los datos de tu
   * tarjeta" sería mandarlo a buscar un problema que no existe.
   */
  it("el desafío 3DS vencido tiene motivo propio", () => {
    expect(motivoDeMercadoPago("failed", "3ds_challenge_expired")).toBe("desafio_vencido");
  });

  it("los errores técnicos caen en desconocido", () => {
    expect(motivoDeMercadoPago("failed", "invalid_card_token")).toBe("desconocido");
    expect(motivoDeMercadoPago("failed", "processing_error")).toBe("desconocido");
  });

  it("un código nuevo de MP cae en desconocido, no rompe", () => {
    expect(motivoDeMercadoPago("failed", "codigo_que_no_existe")).toBe("desconocido");
    expect(motivoDeMercadoPago("failed", undefined)).toBe("desconocido");
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
    status: "action_required",
    transactions: {
      payments: [{ status: "action_required", status_detail: "pending_challenge", three_ds_info: info }],
    },
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

  it("no devuelve desafío si la orden no lo está pidiendo", () => {
    expect(
      desafio3DS({
        status: "processed",
        transactions: {
          payments: [{
            status: "processed",
            status_detail: "accredited",
            three_ds_info: { external_resource_url: "https://banco.test/acs", creq: "abc" },
          }],
        },
      }),
    ).toBeUndefined();
  });
});

describe("esPendienteConocido / esReversion", () => {
  it("reconoce los pendientes documentados", () => {
    expect(esPendienteConocido("action_required")).toBe(true);
    expect(esPendienteConocido("processing")).toBe(true);
    expect(esPendienteConocido("processed")).toBe(false);
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
    expect(esReversion("failed")).toBe(false);
    expect(esReversion("processed")).toBe(false);
  });
});
