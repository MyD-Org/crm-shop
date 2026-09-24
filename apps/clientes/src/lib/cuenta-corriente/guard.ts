/**
 * Guard común de las API de cuenta corriente de Mi cuenta. SOLO servidor.
 *
 * El cliente sale SIEMPRE de la identidad (Clerk + vinculación, o la cookie
 * heredada del portal del CRM): ningún id de contacto se acepta del query, del
 * body ni del path. Toda respuesta es `private, no-store`: son datos de UN
 * cliente y ningún intermediario puede guardarlos.
 */
import { identidadActual, type ClienteComercial } from "../auth";

export const SIN_SESION = "Inicie sesión para ver su cuenta corriente.";
export const SIN_VINCULO = "Vincule su cuenta de cliente para ver sus documentos.";

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
 * Anónimo ⇒ 401; con sesión pero sin cuenta de cliente vinculada ⇒ 403;
 * vinculado ⇒ `{ cliente }`.
 */
export async function requerirCliente(): Promise<ResultadoGuard> {
  const { clerkUserId, cliente } = await identidadActual();
  if (cliente?.codigocliente) return { cliente };
  if (!clerkUserId) return { error: jsonNoStore({ error: SIN_SESION }, { status: 401 }) };
  return { error: jsonNoStore({ error: SIN_VINCULO }, { status: 403 }) };
}
