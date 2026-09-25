/**
 * Página Envíos y pagos: el contenido sale de las reglas de `lib/envio.ts` y
 * de los flags (`envio`, `pagos`, `cuotas`) que resuelve la página en el
 * server. Nada de texto fijo duplicado: si cambian las ciudades o el mínimo,
 * la página se acomoda sola.
 */
import {
  CIUDADES_ENVIO,
  ENTREGA_LABEL,
  MINIMO_ENVIO,
  PAGO_LABEL,
  pagosDisponibles,
  type EntregaTipo,
} from "@/lib/envio";
import { fmtPesosEnteros } from "@/lib/format";
import type { Bloque } from "./comun";

function listar(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

function mediosDe(tipo: EntregaTipo): string {
  return listar(pagosDisponibles(tipo, true).map((m) => PAGO_LABEL[m]));
}

export function bloquesEnviosYPagos(ctx: { envio: boolean; pagos: boolean; cuotas: boolean }): Bloque[] {
  const entregas: Bloque = ctx.envio
    ? {
        titulo: "Entregas",
        parrafos: [
          `${ENTREGA_LABEL.envio}: disponible para ${listar(CIUDADES_ENVIO)}, en compras desde ${fmtPesosEnteros(MINIMO_ENVIO)} sin impuestos.`,
          `Para otras localidades, elija «${ENTREGA_LABEL.retiro}» al finalizar la compra y el comercio coordinará la entrega con usted.`,
        ],
      }
    : {
        titulo: "Entregas",
        parrafos: [
          `Por el momento, las compras se entregan con la modalidad «${ENTREGA_LABEL.retiro}»: una vez confirmado el pedido, el comercio se comunicará con usted para coordinar.`,
        ],
      };

  const pagos: Bloque = ctx.pagos
    ? {
        titulo: "Medios de pago",
        parrafos: [
          `Con ${ENTREGA_LABEL.retiro.toLowerCase()}: ${mediosDe("retiro")}.`,
          ...(ctx.envio ? [`Con ${ENTREGA_LABEL.envio.toLowerCase()}: ${mediosDe("envio")}.`] : []),
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
