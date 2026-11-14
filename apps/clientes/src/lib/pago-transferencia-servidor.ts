/**
 * Con qué lista cotiza el carrito el precio con transferencia, para quien mira. Lo comparten la
 * página /carrito y la hoja del carrito del celular (vía /api/carrito/pago-transferencia).
 *
 * null = sin precio con transferencia: el medio no está activo, no aplica a la modalidad o no tiene
 * lista propia; o el comprador tiene precio propio (cuenta corriente o lista privada), que no
 * depende del medio.
 */
import type { EntregaTipo } from "./envio";
import { mediosOfrecibles } from "./medios-pago-datos";
import { esCompradorCuentaCorriente } from "./medios-pago";
import { SLUG_TRANSFERENCIA } from "./cuentas-bancarias";
import { pagoParaCotizar } from "./lista-medio";
import { listaPrivadaDelComprador } from "./lista-cuenta-repo";

export type PagoTransferencia = { listaKey: string; pagoMetodo: string } | null;

export async function pagoTransferenciaDelVisitante(
  cliente: Parameters<typeof esCompradorCuentaCorriente>[0],
  entregaTipo: EntregaTipo,
): Promise<PagoTransferencia> {
  const precioPropio =
    esCompradorCuentaCorriente(cliente) || (cliente ? Boolean(await listaPrivadaDelComprador().catch(() => null)) : false);
  const medios = precioPropio ? [] : await mediosOfrecibles().catch(() => []);
  const transferencia = medios.find((m) => m.slug === SLUG_TRANSFERENCIA && m.activo) ?? null;
  const pago = transferencia ? pagoParaCotizar(medios, entregaTipo, transferencia) : null;
  return pago?.pagoMetodo ? { listaKey: pago.listaKey, pagoMetodo: pago.pagoMetodo } : null;
}
