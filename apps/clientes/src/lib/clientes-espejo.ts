/**
 * Espejo de los usuarios de Clerk en `shop.clientes` (migración 0018). SOLO
 * servidor.
 *
 * Lo usan el webhook `/api/webhooks/clerk` y el backfill
 * (`scripts/backfill-clientes-clerk.ts`): los dos reciben el MISMO formato de
 * usuario (el `UserJSON` de la Backend API de Clerk), así que hay un solo
 * mapeo. La escritura la deciden las funciones SQL de la 0018 (orden por
 * `updated_at`, idempotencia, baja anonimizada): acá sólo se las llama.
 *
 * El tenant lo pasa quien llama (el del deploy), nunca sale del payload.
 */
import { sql } from "drizzle-orm";
import type { WebhookEvent } from "@clerk/nextjs/webhooks";
import { getDb } from "@/db";

/** El usuario tal como lo mandan el webhook (`evt.data`) y `GET /v1/users`. */
export type UsuarioClerkJSON = Extract<WebhookEvent, { type: "user.created" | "user.updated" }>["data"];

export type DatosClienteClerk = {
  clerkUserId: string;
  email: string | null;
  nombre: string | null;
  creadoEn: Date | null;
  actualizadoEn: Date;
};

export type ResultadoEspejoCliente =
  | "insertado"
  | "actualizado"
  | "ignorado"
  | "eliminado"
  | "rechazado";

/** Mismos topes que el CHECK `sc_largos`: un dato fuera de rango no puede trabar el webhook. */
const MAX_EMAIL = 254;
const MAX_NOMBRE = 200;

function emailPrimario(u: UsuarioClerkJSON): string | null {
  const id = u.primary_email_address_id;
  if (!id || !Array.isArray(u.email_addresses)) return null;
  const email = u.email_addresses.find((e) => e.id === id)?.email_address?.trim();
  if (!email || email.length > MAX_EMAIL) return null;
  return email;
}

function nombreCompleto(u: UsuarioClerkJSON): string | null {
  const nombre = [u.first_name, u.last_name]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean)
    .join(" ");
  return nombre ? nombre.slice(0, MAX_NOMBRE) : null;
}

export function datosDeUsuarioClerk(u: UsuarioClerkJSON): DatosClienteClerk {
  return {
    clerkUserId: u.id,
    email: emailPrimario(u),
    nombre: nombreCompleto(u),
    creadoEn: typeof u.created_at === "number" ? new Date(u.created_at) : null,
    actualizadoEn: new Date(u.updated_at),
  };
}

async function llamar(consulta: ReturnType<typeof sql>): Promise<ResultadoEspejoCliente> {
  const filas = (await getDb().execute(consulta)) as unknown as { resultado: string }[];
  return (filas[0]?.resultado ?? "rechazado") as ResultadoEspejoCliente;
}

/**
 * Alta o actualización. Las fechas viajan como ISO y se castean en SQL: un
 * `Date` suelto como parámetro lo serializa postgres.js a su manera. Lanza si
 * la base falla: el webhook tiene que responder 5xx para que Clerk reintente.
 */
export function registrarUsuarioClerk(
  tenantId: string,
  d: DatosClienteClerk,
): Promise<ResultadoEspejoCliente> {
  const creado = d.creadoEn ? d.creadoEn.toISOString() : null;
  return llamar(
    sql`select shop.clientes_upsert_clerk(${tenantId}, ${d.clerkUserId}, ${d.email}, ${d.nombre}, ${creado}::timestamptz, ${d.actualizadoEn.toISOString()}::timestamptz) as resultado`,
  );
}

/** Baja (`user.deleted`): anonimiza la fila o deja un tombstone. Lanza si la base falla. */
export function eliminarUsuarioClerk(
  tenantId: string,
  clerkUserId: string,
): Promise<ResultadoEspejoCliente> {
  return llamar(
    sql`select shop.clientes_eliminar_clerk(${tenantId}, ${clerkUserId}) as resultado`,
  );
}
