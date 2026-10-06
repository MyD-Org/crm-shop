/**
 * Página Envíos y pagos: el contenido sale de la configuración de envío del CRM
 * (`ConfigEnvio`, texto con `textoRegla`), de los medios de pago activos del CRM por modalidad
 * (`medios_pago_shop`) y del flag `cuotas`, que resuelve la página en el server. Nada de texto fijo
 * duplicado: si cambian el alcance, el mínimo o los medios, la página se acomoda sola.
 */
import {
  ENTREGA_LABEL,
  PAGO_LABEL,
  textoRegla,
  type ConfigEnvio,
  type EntregaTipo,
} from "@/lib/envio";
import { SLUG_MERCADOPAGO, mediosParaModalidad, type MedioPago } from "@/lib/medios-pago";
import type { Bloque } from "./comun";

function listar(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

const PAGO_A_COORDINAR = `${PAGO_LABEL.a_coordinar}: una vez confirmado el pedido, el comercio se comunicará con usted para acordar el medio de pago.`;

/** Nombres de los medios que aplican a la modalidad; vacío si ninguno. */
function mediosDe(tipo: EntregaTipo, medios: readonly MedioPago[]): string {
  return listar(mediosParaModalidad(medios, tipo).map((m) => m.nombre));
}

/**
 * `medios`: los activos del CRM que el Shop puede ofrecer (sin Mercado Pago si faltan credenciales).
 * Sin medios aplicables a ninguna modalidad, el pago se coordina con un asesor.
 */
export function bloquesEnviosYPagos(ctx: { envio: ConfigEnvio; medios: readonly MedioPago[]; cuotas: boolean }): Bloque[] {
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

  const modalidades: EntregaTipo[] = ctx.envio.domicilioActivo ? ["retiro", "envio"] : ["retiro"];
  const hayMedios = modalidades.some((t) => mediosParaModalidad(ctx.medios, t).length > 0);
  const conMp = modalidades.some((t) =>
    mediosParaModalidad(ctx.medios, t).some((m) => m.slug === SLUG_MERCADOPAGO),
  );

  const pagos: Bloque = hayMedios
    ? {
        titulo: "Medios de pago",
        parrafos: [
          ...modalidades.map((t) => {
            const lista = mediosDe(t, ctx.medios);
            const cuando = `Con ${ENTREGA_LABEL[t].toLowerCase()}`;
            return lista ? `${cuando}: ${lista}.` : `${cuando}: el pago se coordina con un asesor una vez confirmado el pedido.`;
          }),
          ...(ctx.cuotas && conMp
            ? ["Las cuotas sin interés disponibles con tarjeta de crédito se informan antes de confirmar la compra."]
            : []),
        ],
      }
    : { titulo: "Medios de pago", parrafos: [PAGO_A_COORDINAR] };

  return [entregas, pagos];
}
