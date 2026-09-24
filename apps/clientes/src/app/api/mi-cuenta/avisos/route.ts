import { contarNoLeidos, listarAvisos, marcarLeidos } from "@/lib/cuenta-corriente/avisos";
import { jsonNoStore, requerirCliente } from "@/lib/cuenta-corriente/guard";
import { AVISOS_CAIDOS, AVISOS_INVALIDOS, AVISOS_NO_MARCADOS } from "@/lib/cuenta-corriente/mensajes";

/**
 * Avisos de vencimiento de Mi cuenta (ex campana del portal).
 * `GET` → `{ avisos, noLeidos }` (hasta 50, agrupados por canal).
 * `PATCH { ids? }` → marca como leídos esos avisos (sin `ids`, todos). Los ids
 * ajenos o inválidos se ignoran y la respuesta es 200 igual (AVI-3).
 *
 * Portado de apps/admin/src/app/api/notifications/log/route.ts. El cliente
 * sale de la identidad, nunca del body.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requerirCliente();
  if (guard.error) return guard.error;
  const codigo = guard.cliente.codigocliente;
  try {
    const [avisos, noLeidos] = await Promise.all([listarAvisos(codigo), contarNoLeidos(codigo)]);
    return jsonNoStore({ avisos, noLeidos });
  } catch (err) {
    console.error(`mi-cuenta/avisos: lectura falló (${err instanceof Error ? err.name : "desconocido"})`);
    return jsonNoStore({ error: AVISOS_CAIDOS }, { status: 502 });
  }
}

/** `undefined` = todos; `null` = cuerpo inválido. */
function idsDelCuerpo(body: unknown): string[] | undefined | null {
  if (body === null || typeof body !== "object") return undefined;
  const { ids } = body as { ids?: unknown };
  if (ids === undefined) return undefined;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) return null;
  return ids;
}

export async function PATCH(request: Request) {
  const guard = await requerirCliente();
  if (guard.error) return guard.error;
  const codigo = guard.cliente.codigocliente;

  const ids = idsDelCuerpo(await request.json().catch(() => undefined));
  if (ids === null) return jsonNoStore({ error: AVISOS_INVALIDOS }, { status: 400 });
  try {
    await marcarLeidos(codigo, ids);
    return jsonNoStore({ ok: true, noLeidos: await contarNoLeidos(codigo) });
  } catch (err) {
    console.error(`mi-cuenta/avisos: marcar falló (${err instanceof Error ? err.name : "desconocido"})`);
    return jsonNoStore({ error: AVISOS_NO_MARCADOS }, { status: 502 });
  }
}
