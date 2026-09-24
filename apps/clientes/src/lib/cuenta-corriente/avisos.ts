/**
 * Avisos de vencimiento del cliente (`public.notification_log`). SOLO servidor.
 *
 * El ENVÍO sigue en el CRM (`apps/admin/src/lib/notifications.ts`), sin
 * cambios: el Shop lee las filas del tenant y del cliente de la identidad y
 * sólo puede escribir `read_at` (GRANT por columna de la 0032).
 *
 * El CRM escribe una fila por canal del mismo `(factura, tipo)`: se agrupan en
 * UN aviso (el envío más reciente) y se marcan leídas juntas. El contador cuenta
 * avisos, no filas. Sólo avisos enviados (`status = 'sent'`) de los tipos que
 * el Shop sabe mostrar.
 */
import { cache } from "react";
import { and, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { crmAvisos } from "@/db/crm";
import { shopTenantId } from "../tenant";
import type { Aviso } from "./vista-avisos";

export const AVISOS_LIMITE = 50;
/** Tope de ids por PATCH: la lista nunca muestra más de 50 avisos × 2 canales. */
export const AVISOS_IDS_MAX = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FECHA_AR = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Argentina/Buenos_Aires",
});

/** Tenant del Shop + cliente de la identidad: ningún aviso ajeno entra ni se marca. */
function delCliente(codigocliente: string) {
  return and(eq(crmAvisos.tenantId, shopTenantId()), eq(crmAvisos.codigocliente, codigocliente));
}

/** Enviados y de los tipos que se saben mostrar. */
const visibles = and(
  eq(crmAvisos.status, "sent"),
  or(
    like(crmAvisos.type, "before_due_%"),
    like(crmAvisos.type, "after_due_%"),
    eq(crmAvisos.type, "conditions_changed"),
  ),
);

/**
 * Los avisos del cliente, del más reciente al más viejo, agrupados por
 * `(factura, tipo)`. A lo sumo `limite` avisos.
 */
export async function listarAvisos(codigocliente: string, limite = AVISOS_LIMITE): Promise<Aviso[]> {
  const filas = await getDb()
    .select({
      id: crmAvisos.id,
      facturaId: crmAvisos.facturaId,
      facturaAlegraId: crmAvisos.facturaAlegraId,
      type: crmAvisos.type,
      sentAt: crmAvisos.sentAt,
      readAt: crmAvisos.readAt,
    })
    .from(crmAvisos)
    .where(and(delCliente(codigocliente), visibles))
    .orderBy(desc(crmAvisos.sentAt))
    // Hasta una fila por canal (mail y WhatsApp) por aviso.
    .limit(limite * 2);

  const porClave = new Map<string, Aviso>();
  for (const f of filas) {
    const clave = `${f.facturaId}\u0000${f.type}`;
    const existente = porClave.get(clave);
    if (existente) {
      existente.ids.push(f.id);
      existente.leido = existente.leido && f.readAt !== null;
      // La factura de Alegra puede faltar en la fila más reciente (anterior a 0022) y no en otra.
      existente.facturaAlegraId ??= f.facturaAlegraId;
      continue;
    }
    const enviado = new Date(f.sentAt);
    porClave.set(clave, {
      id: f.id,
      ids: [f.id],
      facturaId: f.facturaId,
      facturaAlegraId: f.facturaAlegraId,
      type: f.type,
      sentAt: enviado.toISOString(),
      fecha: FECHA_AR.format(enviado),
      leido: f.readAt !== null,
    });
  }
  return [...porClave.values()].slice(0, limite);
}

/** Avisos (no filas) sin leer. Una consulta por request (`cache`): la usan el layout y el resumen. */
export const contarNoLeidos = cache(async function contarNoLeidos(codigocliente: string): Promise<number> {
  const [fila] = await getDb()
    .select({ n: sql<number>`count(distinct (${crmAvisos.facturaId}, ${crmAvisos.type}))`.mapWith(Number) })
    .from(crmAvisos)
    .where(and(delCliente(codigocliente), visibles, isNull(crmAvisos.readAt)));
  return fila?.n ?? 0;
});

/**
 * Marca como leídos los avisos del cliente: `ids` (los suyos; los ajenos o
 * inválidos se ignoran sin error, AVI-3) o, sin `ids`, todos. Sólo toca
 * `read_at`, y sólo en filas todavía no leídas.
 */
export async function marcarLeidos(codigocliente: string, ids?: readonly string[]): Promise<void> {
  const noLeidas = and(delCliente(codigocliente), isNull(crmAvisos.readAt));
  if (ids === undefined) {
    await getDb().update(crmAvisos).set({ readAt: new Date() }).where(noLeidas);
    return;
  }
  // Un id que no es uuid haría fallar la consulta entera en Postgres.
  const validos = [...new Set(ids.filter((id) => UUID.test(id)))].slice(0, AVISOS_IDS_MAX);
  if (validos.length === 0) return;
  await getDb()
    .update(crmAvisos)
    .set({ readAt: new Date() })
    .where(and(noLeidas, inArray(crmAvisos.id, validos)));
}
