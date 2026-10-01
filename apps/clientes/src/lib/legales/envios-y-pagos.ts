/**
 * Página Envíos y pagos: el contenido sale de la configuración de envío del CRM
 * (`ConfigEnvio`, texto con `textoRegla`) y de los flags (`pagos`, `cuotas`)
 * que resuelve la página en el server. Nada de texto fijo duplicado: si cambian
 * el alcance o el mínimo, la página se acomoda sola.
 */
import {
  ENTREGA_LABEL,
  PAGO_LABEL,
  pagosDisponibles,
  textoRegla,
  type ConfigEnvio,
  type EntregaTipo,
} from "@/lib/envio";
import type { Bloque } from "./comun";

function listar(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

function mediosDe(tipo: EntregaTipo): string {
  return listar(pagosDisponibles(tipo, true).map((m) => PAGO_LABEL[m]));
}

export function bloquesEnviosYPagos(ctx: { envio: ConfigEnvio; pagos: boolean; cuotas: boolean }): Bloque[] {
  const entregas: Bloque = ctx.envio.domicilioActivo
    ? {
        titulo: "Entregas",
        parrafos: [
          `${ENTREGA_LABEL.envio}: ${textoRegla(ctx.envio)}`,
          `Una vez confirmado el pedido, el comercio se comunicará con usted para coordinar la entrega.`,
        ],
      }
    : {
        titulo: "Entregas",
        parrafos: [
          `Por el momento, la única opción de entrega es «${ENTREGA_LABEL.retiro}»: el envío a domicilio no está disponible.`,
        ],
      };

  const pagos: Bloque = ctx.pagos
    ? {
        titulo: "Medios de pago",
        parrafos: [
          `Con ${ENTREGA_LABEL.retiro.toLowerCase()}: ${mediosDe("retiro")}.`,
          ...(ctx.envio.domicilioActivo ? [`Con ${ENTREGA_LABEL.envio.toLowerCase()}: ${mediosDe("envio")}.`] : []),
          ...(ctx.cuotas
            ? ["Cuando elija pagar en cuotas, el costo financiero total (CFT) se informa antes de confirmar la compra."]
            : []),
        ],
      }
    : {
        titulo: "Medios de pago",
        parrafos: [
          `${PAGO_LABEL.a_coordinar}: una vez confirmado el pedido, el comercio se comunicará con usted para acordar el medio de pago.`,
        ],
      };

  return [entregas, pagos];
}
