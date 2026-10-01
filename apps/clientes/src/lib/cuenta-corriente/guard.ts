/**
 * Guard común de las API de cuenta corriente de Mi cuenta. SOLO servidor.
 *
 * Sólo cuenta corriente: sin vínculo o de contado el grupo Facturación no existe
 * (ver `accesoFacturacion`), y sus API responden 404 como las páginas.
 *
 * El cliente sale SIEMPRE de la identidad (Clerk + vinculación, o la cookie
 * heredada del portal del CRM): ningún id de contacto se acepta del query, del
 * body ni del path. Toda respuesta es `private, no-store`: son datos de UN
 * cliente y ningún intermediario puede guardarlos.
 */
import { accesoFacturacion } from "../acceso-facturacion";
import { identidadActual, type ClienteComercial } from "../auth";
import { duenioDe, type Duenio } from "../comprobantes/duenio";

export const SIN_SESION = "Inicie sesión para ver su cuenta corriente.";
export const SIN_SESION_COMPRADOR = "Inicie sesión para continuar.";
export const NO_DISPONIBLE = "Esta sección no está disponible para su cuenta.";

const NO_STORE = "private, no-store";

/** Misma respuesta con `Cache-Control: private, no-store`. */
export function noStore(res: Response): Response {
  res.headers.set("Cache-Control", NO_STORE);
  return res;
}

/** `Response.json` con `private, no-store`. */
export function jsonNoStore(body: unknown, init: ResponseInit = {}): Response {
  return noStore(Response.json(body, init));
}

export type ResultadoGuard = { cliente: ClienteComercial; error?: undefined } | { cliente?: undefined; error: Response };

/**
 * Anónimo ⇒ 401; con identidad pero sin acceso a Facturación (sin vínculo, de
 * contado, o el espejo no respondió) ⇒ 404; cuenta corriente ⇒ `{ cliente }`.
 */
export async function requerirCuentaCorriente(): Promise<ResultadoGuard> {
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) return { error: jsonNoStore({ error: SIN_SESION }, { status: 401 }) };
  if (cliente?.codigocliente && (await accesoFacturacion())) return { cliente };
  return { error: jsonNoStore({ error: NO_DISPONIBLE }, { status: 404 }) };
}

export interface Comprador {
  clerkUserId: string | null;
  /** null = comprador sin cuenta corriente vinculada. */
  cliente: ClienteComercial | null;
  /** Quién es el dueño de sus comprobantes (ver `Duenio`). */
  duenio: Duenio;
}

export type ResultadoCompradorGuard = { comprador: Comprador; error?: undefined } | { comprador?: undefined; error: Response };

/**
 * Para lo que puede hacer CUALQUIER comprador logueado sobre su propio pedido (subir el
 * comprobante de su transferencia): con o sin cuenta corriente, de contado o corriente. No
 * pasa por `accesoFacturacion`: lo que se toca es el pedido, no la cuenta corriente. Anónimo ⇒
 * 401; la pertenencia del pedido la valida cada ruta con el `duenio`.
 */
export async function requerirComprador(): Promise<ResultadoCompradorGuard> {
  const identidad = await identidadActual();
  const duenio = duenioDe(identidad);
  if (!duenio) return { error: jsonNoStore({ error: SIN_SESION_COMPRADOR }, { status: 401 }) };
  return { comprador: { clerkUserId: identidad.clerkUserId, cliente: identidad.cliente, duenio } };
}
