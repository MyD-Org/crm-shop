/**
 * Aplicar un cupón a varias cotizaciones de un mismo carrito o pedido (la principal, cada card del paso
 * Pago, cada cantidad de cuotas) con UN contexto: mismo instante, misma entrega, mismo resultado de la
 * cuenta. El total a la lista general (para el mínimo) se cotiza una sola vez y sólo si la promoción
 * tiene mínimo y no es una recotización congelada.
 */
import type { Cotizacion } from "../cotizacion";
import { medioConFormas } from "../lista-medio";
import type { OpcionCobro } from "../pagos/opciones-cobro";
import { aplicarCupon } from "./reglas";
import type { ContextoCupon, CuponParaCotizar, OpcionCupon } from "./tipos";

export type AplicadorCupon = (c: Cotizacion, opcion: OpcionCupon | null) => Promise<Cotizacion>;

export function aplicadorDeCupon(a: {
  cupon: CuponParaCotizar;
  entrega: ContextoCupon["entrega"];
  nombresMedios?: Record<string, string>;
  /** Total con IVA de todo el carrito a la lista general (sin lista de medio) y SIN el costo de envío. */
  totalListaGeneral: () => Promise<number>;
  /** Ver `ContextoCupon.envioGratisAplica`; ausente = true. */
  envioGratisAplica?: boolean;
  ahora?: Date;
}): AplicadorCupon {
  const ahora = a.ahora ?? new Date();
  const congelado = Boolean(a.cupon.congelado);
  const necesitaTotal = a.cupon.promo.minimo !== null && !congelado;
  let total: Promise<number> | null = null;
  return async (c, opcion) =>
    aplicarCupon(c, a.cupon.promo, {
      ahora,
      opcion,
      entrega: a.entrega,
      totalListaGeneral: necesitaTotal ? await (total ??= a.totalListaGeneral()) : 0,
      motivoCuenta: a.cupon.motivoCuenta,
      verificado: a.cupon.verificado,
      congelado,
      ...(a.envioGratisAplica === false ? { envioGratisAplica: false } : {}),
      ...(a.nombresMedios ? { nombresMedios: a.nombresMedios } : {}),
    });
}

/** La opción de pago para el cupón: cuotas >= 2 son sin interés (las con interés usan el precio en 1 pago). */
export function opcionCupon(slug: string, forma: OpcionCobro | null, cuotas: number | null | undefined): OpcionCupon {
  return { slug, forma, cuotasSinInteres: (cuotas ?? 1) > 1, conFormas: medioConFormas(slug) };
}

/** slug → nombre visible de los medios del CRM (texto de "válido sólo pagando con …"). */
export function nombresDeMedios(medios: readonly { slug: string; nombre: string }[]): Record<string, string> {
  return Object.fromEntries(medios.map((m) => [m.slug, m.nombre]));
}
