// Portado de apps/admin/src/lib/payment-receipts.ts, SÓLO lo que usa el flujo
// de informar pago del cliente: alta, tope diario, máquina de estados del
// confirm, lease del mail e historial. Sin `cleanupStale` (el Shop no tiene
// DELETE: la limpieza la hace el listado del backoffice) ni nada del admin.
//
// La fila es una MÁQUINA DE ESTADOS: cada transición es un UPDATE condicional
// con WHERE status = … RETURNING (sin leer y después escribir), lo que da
// idempotencia y exclusión mutua sin locks. TODA lectura y escritura filtra
// tenant_id (y el codigocliente de la identidad cuando corresponde): un id de
// otro cliente se comporta como inexistente.
//
// Permisos (migración 0032 de apps/admin): SELECT e INSERT en la tabla y
// UPDATE sólo de status, processing_started_at, reject_reason, file_*,
// converted_from, email_*, submitted_at y updated_at. Ningún UPDATE de acá
// puede tocar otra columna.
//
// `amount` llega de drizzle como string decimal ("12345.67"): se persiste y
// serializa tal cual, nunca se pasa a float para guardar.

import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { crmComprobantes } from "@/db/crm";
import { CONFIRM_LEASE_SECONDS, EMAIL_LEASE_SECONDS } from "./validacion";

export type ComprobanteFila = typeof crmComprobantes.$inferSelect;

/** Estados visibles para el cliente y el backoffice. Los internos
 * (`uploading`, `processing`, `rejected`) nunca se muestran. */
export const ESTADOS_VISIBLES = ["pending", "loaded"] as const;

/** Tamaño de página del historial (el mismo que el portal). */
export const COMPROBANTES_PAGE_SIZE = 10;

/** `email_error` se trunca a esto (≤500, sin secretos). */
export const EMAIL_ERROR_MAX_CHARS = 500;

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Alta
// ---------------------------------------------------------------------------

export interface AltaComprobante {
  codigocliente: string;
  razonsocial: string;
  cuit: string;
  clientEmail: string | null;
  /** Decimal string ya validado ("150000.50"). */
  amount: string;
  /** "YYYY-MM-DD". */
  paidOn: string;
  method: string;
  methodOther: string | null;
  notes: string | null;
  declaredContentType: string;
  declaredSize: number;
}

/**
 * Crea la fila en `uploading`. Los datos del cliente salen de la identidad,
 * nunca del body. Los valores que en el CRM son default de la tabla se pasan
 * explícitos (el Shop no declara defaults: no es dueño del DDL).
 */
export async function crearSubiendo(tenantId: string, input: AltaComprobante, now: Date): Promise<ComprobanteFila> {
  const [row] = await getDb()
    .insert(crmComprobantes)
    .values({
      id: randomUUID(),
      tenantId,
      ...input,
      currency: "ARS",
      status: "uploading",
      emailStatus: "pending",
      emailAttempts: 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row;
}

/** Filas no-`uploading` del cliente en las últimas 24 h (tope diario; incluye
 * `rejected`, que cuenta contra la cuota). */
export async function contarRecientes(tenantId: string, codigocliente: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - DAY_MS);
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(crmComprobantes)
    .where(
      and(
        eq(crmComprobantes.tenantId, tenantId),
        eq(crmComprobantes.codigocliente, codigocliente),
        ne(crmComprobantes.status, "uploading"),
        gte(crmComprobantes.createdAt, since),
      ),
    );
  return row?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Máquina de estados del confirm (lease de 120 s)
// ---------------------------------------------------------------------------

/** CLAIM: `uploading → processing` (o retoma un `processing` con el lease vencido). */
export async function tomarParaConfirmar(
  tenantId: string,
  codigocliente: string,
  id: string,
  now: Date,
): Promise<ComprobanteFila | null> {
  const leaseExpiredBefore = new Date(now.getTime() - CONFIRM_LEASE_SECONDS * 1000);
  const [row] = await getDb()
    .update(crmComprobantes)
    .set({ status: "processing", processingStartedAt: now, updatedAt: now })
    .where(
      and(
        eq(crmComprobantes.tenantId, tenantId),
        eq(crmComprobantes.codigocliente, codigocliente),
        eq(crmComprobantes.id, id),
        or(
          eq(crmComprobantes.status, "uploading"),
          and(eq(crmComprobantes.status, "processing"), lt(crmComprobantes.processingStartedAt, leaseExpiredBefore)),
        ),
      ),
    )
    .returning();
  return row ?? null;
}

/** Lectura tras un claim fallido (para decidir idempotente / en curso / rechazo). */
export async function buscarDelCliente(
  tenantId: string,
  codigocliente: string,
  id: string,
): Promise<ComprobanteFila | null> {
  const [row] = await getDb()
    .select()
    .from(crmComprobantes)
    .where(
      and(
        eq(crmComprobantes.tenantId, tenantId),
        eq(crmComprobantes.codigocliente, codigocliente),
        eq(crmComprobantes.id, id),
      ),
    );
  return row ?? null;
}

/** Libera el lease de un confirm interrumpido: `processing → uploading`. */
export async function liberar(tenantId: string, id: string, now: Date): Promise<boolean> {
  const rows = await getDb()
    .update(crmComprobantes)
    .set({ status: "uploading", processingStartedAt: null, updatedAt: now })
    .where(
      and(eq(crmComprobantes.tenantId, tenantId), eq(crmComprobantes.id, id), eq(crmComprobantes.status, "processing")),
    )
    .returning({ id: crmComprobantes.id });
  return rows.length > 0;
}

/** Rechazo: `processing → rejected` con el código del motivo (un reintento
 * responde el mismo error; no se resucita). */
export async function rechazar(tenantId: string, id: string, reason: string, now: Date): Promise<void> {
  await getDb()
    .update(crmComprobantes)
    .set({ status: "rejected", rejectReason: reason, processingStartedAt: null, updatedAt: now })
    .where(
      and(eq(crmComprobantes.tenantId, tenantId), eq(crmComprobantes.id, id), eq(crmComprobantes.status, "processing")),
    );
}

export interface CamposPublicacion {
  fileKey: string;
  fileMime: string;
  fileSize: number;
  fileSha256: string;
  convertedFrom: string | null;
}

/** Publicación: `processing → pending` con los datos verificados del archivo.
 * 0 filas ⇒ el lease se perdió (otro confirm publicó): el llamador responde
 * "en curso", sin mail. */
export async function publicar(
  tenantId: string,
  id: string,
  fields: CamposPublicacion,
  at: Date,
): Promise<ComprobanteFila | null> {
  const [row] = await getDb()
    .update(crmComprobantes)
    .set({
      status: "pending",
      processingStartedAt: null,
      fileKey: fields.fileKey,
      fileMime: fields.fileMime,
      fileSize: fields.fileSize,
      fileSha256: fields.fileSha256,
      convertedFrom: fields.convertedFrom,
      submittedAt: at,
      updatedAt: at,
    })
    .where(
      and(eq(crmComprobantes.tenantId, tenantId), eq(crmComprobantes.id, id), eq(crmComprobantes.status, "processing")),
    )
    .returning();
  return row ?? null;
}

/** Aviso de duplicado: mismo tenant+cliente, mismo sha256 ya publicado, otro
 * id. No bloquea: el confirm y el mail lo informan. */
export async function buscarDuplicado(
  tenantId: string,
  codigocliente: string,
  sha256: string,
  excludeId: string,
): Promise<{ id: string; submittedAt: Date } | null> {
  const [row] = await getDb()
    .select({ id: crmComprobantes.id, submittedAt: crmComprobantes.submittedAt })
    .from(crmComprobantes)
    .where(
      and(
        eq(crmComprobantes.tenantId, tenantId),
        eq(crmComprobantes.codigocliente, codigocliente),
        eq(crmComprobantes.fileSha256, sha256),
        ne(crmComprobantes.id, excludeId),
        inArray(crmComprobantes.status, [...ESTADOS_VISIBLES]),
      ),
    )
    .orderBy(desc(crmComprobantes.submittedAt))
    .limit(1);
  if (!row?.submittedAt) return null;
  return { id: row.id, submittedAt: row.submittedAt };
}

/** Fila publicada (pending/loaded) para armar el mail. */
export async function buscarPublicado(tenantId: string, id: string): Promise<ComprobanteFila | null> {
  const [row] = await getDb()
    .select()
    .from(crmComprobantes)
    .where(
      and(
        eq(crmComprobantes.tenantId, tenantId),
        eq(crmComprobantes.id, id),
        inArray(crmComprobantes.status, [...ESTADOS_VISIBLES]),
      ),
    );
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Mail (lease propio de 60 s)
// ---------------------------------------------------------------------------

/** Toma el lease de envío: suma `email_attempts` SÓLO si la fila está
 * publicada y no hubo un intento en los últimos 60 s. Devuelve el número de
 * intento (para la clave de idempotencia) o null. */
export async function tomarIntentoMail(tenantId: string, id: string, now: Date): Promise<number | null> {
  const leaseExpiredBefore = new Date(now.getTime() - EMAIL_LEASE_SECONDS * 1000);
  const [row] = await getDb()
    .update(crmComprobantes)
    .set({
      emailAttempts: sql`${crmComprobantes.emailAttempts} + 1`,
      emailLastAttemptAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(crmComprobantes.tenantId, tenantId),
        eq(crmComprobantes.id, id),
        inArray(crmComprobantes.status, [...ESTADOS_VISIBLES]),
        or(isNull(crmComprobantes.emailLastAttemptAt), lt(crmComprobantes.emailLastAttemptAt, leaseExpiredBefore)),
      ),
    )
    .returning({ attempts: crmComprobantes.emailAttempts });
  return row?.attempts ?? null;
}

export type ResultadoMail =
  { status: "sent" } | { status: "failed"; error: string } | { status: "skipped"; reason: string };

/** Persiste el resultado del envío. `error` se trunca a EMAIL_ERROR_MAX_CHARS. */
export async function registrarMail(tenantId: string, id: string, outcome: ResultadoMail, now: Date): Promise<void> {
  const errorText = outcome.status === "failed" ? outcome.error : outcome.status === "skipped" ? outcome.reason : null;
  await getDb()
    .update(crmComprobantes)
    .set({
      emailStatus: outcome.status,
      emailError: errorText ? errorText.slice(0, EMAIL_ERROR_MAX_CHARS) : null,
      emailSentAt: outcome.status === "sent" ? now : null,
      updatedAt: now,
    })
    .where(and(eq(crmComprobantes.tenantId, tenantId), eq(crmComprobantes.id, id)));
}

// ---------------------------------------------------------------------------
// Historial del cliente ("Mis comprobantes")
// ---------------------------------------------------------------------------

/** Lo que ve el cliente de cada comprobante: sin file_key, sha256 ni nada del
 * mail o del backoffice, salvo el número del pago de Alegra cuando se registró. */
export interface ComprobanteCliente {
  id: string;
  submittedAt: string;
  paidOn: string;
  amount: string;
  method: string;
  methodOther: string | null;
  status: "pending" | "loaded";
  /** Número del pago de Alegra con el que se registró, si el backoffice lo cargó ahí. */
  pagoAlegra: string | null;
}

export function aComprobanteCliente(row: ComprobanteFila): ComprobanteCliente {
  return {
    id: row.id,
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : "",
    paidOn: row.paidOn,
    amount: row.amount,
    method: row.method,
    methodOther: row.methodOther,
    status: row.status as ComprobanteCliente["status"],
    pagoAlegra: row.status === "loaded" ? row.alegraPaymentNumber : null,
  };
}

/** Página del historial: SÓLO `pending`/`loaded` propios, más recientes primero. */
export async function listarDelCliente(
  tenantId: string,
  codigocliente: string,
  start: number,
): Promise<{ comprobantes: ComprobanteCliente[]; total: number }> {
  const where = and(
    eq(crmComprobantes.tenantId, tenantId),
    eq(crmComprobantes.codigocliente, codigocliente),
    inArray(crmComprobantes.status, [...ESTADOS_VISIBLES]),
  );
  const [rows, count] = await Promise.all([
    getDb()
      .select()
      .from(crmComprobantes)
      .where(where)
      .orderBy(desc(crmComprobantes.submittedAt), desc(crmComprobantes.id))
      .limit(COMPROBANTES_PAGE_SIZE)
      .offset(start),
    getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(crmComprobantes)
      .where(where),
  ]);
  return { comprobantes: rows.map(aComprobanteCliente), total: count[0]?.count ?? 0 };
}
