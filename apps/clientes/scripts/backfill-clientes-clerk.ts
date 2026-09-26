/**
 * Backfill del espejo de usuarios de Clerk en `shop.clientes` (migración 0018).
 *
 *   npm run clientes:backfill -- --dry-run      # sólo cuenta, no escribe
 *   npm run clientes:backfill                   # escribe (idempotente)
 *
 * Carga los usuarios que ya existían antes del webhook `/api/webhooks/clerk`.
 * Correrlo DESPUÉS de dar de alta el webhook, así no se pierde ninguna alta
 * intermedia. Usa la MISMA función SQL que el webhook
 * (`shop.clientes_upsert_clerk`): gana siempre el dato con `updated_at` más
 * nuevo, nunca resucita una baja, y correrlo dos veces da el mismo estado.
 *
 * Entorno (lo lee de `.env.local` si existe):
 *   - CLERK_SECRET_KEY   clave de la Backend API de la instancia de Clerk del Shop.
 *   - DATABASE_URL       rol `shop_app` (el mismo del runtime).
 *   - SHOP_TENANT_ID     tenant de la tienda (slug de public.tenants.id).
 *   - BACKFILL_CONFIRM   obligatorio si la base NO es local: el host exacto.
 *
 * Pide `GET https://api.clerk.com/v1/users?limit=500&offset=N&order_by=+created_at`
 * hasta una página con menos de 500. Ante un 429 espera `Retry-After` (hasta 3
 * reintentos por página) y si sigue, corta con error.
 *
 * Imprime SÓLO cantidades. No escribe archivos. Nunca imprime emails, nombres,
 * la clave de Clerk ni la URL de la base.
 */
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import {
  datosDeUsuarioClerk,
  registrarUsuarioClerk,
  type ResultadoEspejoCliente,
  type UsuarioClerkJSON,
} from "../src/lib/clientes-espejo";

export const CLERK_USERS_LIMIT = 500;
const MAX_REINTENTOS_429 = 3;
const HOSTS_LOCALES = ["localhost", "127.0.0.1", "::1"];

export function urlDePagina(offset: number): string {
  return `https://api.clerk.com/v1/users?limit=${CLERK_USERS_LIMIT}&offset=${offset}&order_by=%2Bcreated_at`;
}

type Opciones = { esperar?: (ms: number) => Promise<void> };
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Recorre todas las páginas de usuarios. `fetchPagina(offset)` devuelve la
 * respuesta HTTP cruda; `onUsuario` se llama una vez por usuario, en orden.
 * Devuelve cuántos usuarios leyó. Los errores llevan sólo el status.
 */
export async function recorrerUsuariosClerk(
  fetchPagina: (offset: number) => Promise<Response>,
  onUsuario: (u: UsuarioClerkJSON) => Promise<void>,
  { esperar = dormir }: Opciones = {},
): Promise<number> {
  let offset = 0;
  let leidos = 0;
  for (;;) {
    let res = await fetchPagina(offset);
    let reintentos = 0;
    while (res.status === 429) {
      if (reintentos >= MAX_REINTENTOS_429) {
        throw new Error(`Clerk respondió 429 ${MAX_REINTENTOS_429 + 1} veces seguidas; reintente más tarde`);
      }
      reintentos += 1;
      const segundos = Number(res.headers.get("retry-after"));
      await esperar((Number.isFinite(segundos) && segundos > 0 ? segundos : 1) * 1000);
      res = await fetchPagina(offset);
    }
    if (!res.ok) throw new Error(`Clerk respondió ${res.status}`);

    const pagina = (await res.json()) as unknown;
    if (!Array.isArray(pagina)) throw new Error("Clerk devolvió una página que no es una lista");
    for (const u of pagina as UsuarioClerkJSON[]) {
      await onUsuario(u);
      leidos += 1;
    }
    if (pagina.length < CLERK_USERS_LIMIT) return leidos;
    offset += CLERK_USERS_LIMIT;
  }
}

export type Existente = { actualizadoEn: Date; eliminado: boolean };
export type ConteoDryRun = { crear: number; actualizar: number; sinCambios: number; conEmail: number; sinEmail: number };

/** Qué haría la función SQL con este usuario (misma regla), sin escribir. */
export function clasificar(u: UsuarioClerkJSON, existentes: Map<string, Existente>, c: ConteoDryRun): void {
  const d = datosDeUsuarioClerk(u);
  if (d.email) c.conEmail += 1;
  else c.sinEmail += 1;
  const e = existentes.get(d.clerkUserId);
  if (!e) c.crear += 1;
  else if (!e.eliminado && e.actualizadoEn.getTime() <= d.actualizadoEn.getTime()) c.actualizar += 1;
  else c.sinCambios += 1;
}

export type Conteo = { leidos: number } & Record<ResultadoEspejoCliente, number>;

export function resumen(c: Conteo): string {
  return `leídos ${c.leidos} · insertados ${c.insertado} · actualizados ${c.actualizado} · ignorados ${c.ignorado} · rechazados ${c.rechazado}`;
}

type Entorno = Record<string, string | undefined>;
export type Destino =
  | { ok: true; host: string; tenant: string; instancia: "live" | "test" | "desconocida" }
  | { ok: false; error: string };

/**
 * Valida el entorno y a dónde se va a escribir. Una base que no es local exige
 * `BACKFILL_CONFIRM=<host>` (mismo criterio que el db:migrate del CRM). Nunca
 * devuelve la URL ni la clave.
 */
export function confirmarDestino(env: Entorno): Destino {
  for (const v of ["DATABASE_URL", "SHOP_TENANT_ID", "CLERK_SECRET_KEY"]) {
    if (!env[v]?.trim()) return { ok: false, error: `Falta ${v} en el entorno.` };
  }
  let host: string;
  try {
    host = new URL(env.DATABASE_URL!.trim()).hostname;
  } catch {
    return { ok: false, error: "DATABASE_URL no es una URL de Postgres válida." };
  }
  if (!HOSTS_LOCALES.includes(host) && env.BACKFILL_CONFIRM?.trim() !== host) {
    return {
      ok: false,
      error: `La base no es local (host ${host}). Para escribir o contar contra ella, vuelva a correr con BACKFILL_CONFIRM=${host}.`,
    };
  }
  const clave = env.CLERK_SECRET_KEY!.trim();
  const instancia = clave.startsWith("sk_live_") ? "live" : clave.startsWith("sk_test_") ? "test" : "desconocida";
  return { ok: true, host, tenant: env.SHOP_TENANT_ID!.trim(), instancia };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const destino = confirmarDestino(process.env);
  if (!destino.ok) {
    console.error(destino.error);
    process.exit(1);
  }
  console.log(
    `backfill clientes · base ${destino.host} · tenant ${destino.tenant} · Clerk ${destino.instancia}${dryRun ? " · DRY-RUN (no escribe)" : ""}`,
  );

  const { getDb } = await import("../src/db");
  const db = getDb();
  const clave = process.env.CLERK_SECRET_KEY!.trim();
  const fetchPagina = (offset: number) =>
    fetch(urlDePagina(offset), { headers: { Authorization: `Bearer ${clave}` } });

  try {
    if (dryRun) {
      const filas = (await db.execute(
        sql`select clerk_user_id, actualizado_en_clerk, eliminado_en from shop.clientes where tenant_id = ${destino.tenant}`,
      )) as unknown as { clerk_user_id: string; actualizado_en_clerk: string | Date; eliminado_en: unknown }[];
      const existentes = new Map<string, Existente>(
        filas.map((f) => [
          f.clerk_user_id,
          { actualizadoEn: new Date(f.actualizado_en_clerk), eliminado: f.eliminado_en != null },
        ]),
      );
      const c: ConteoDryRun = { crear: 0, actualizar: 0, sinCambios: 0, conEmail: 0, sinEmail: 0 };
      const leidos = await recorrerUsuariosClerk(fetchPagina, async (u) => clasificar(u, existentes, c));
      console.log(
        `leídos ${leidos} (con email ${c.conEmail} · sin email ${c.sinEmail}) · ya en el espejo ${existentes.size} · a crear ${c.crear} · a actualizar ${c.actualizar} · sin cambios ${c.sinCambios}`,
      );
      return;
    }

    const c: Conteo = { leidos: 0, insertado: 0, actualizado: 0, ignorado: 0, eliminado: 0, rechazado: 0 };
    c.leidos = await recorrerUsuariosClerk(fetchPagina, async (u) => {
      c[await registrarUsuarioClerk(destino.tenant, datosDeUsuarioClerk(u))] += 1;
    });
    console.log(resumen(c));
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // Sólo el mensaje propio (status HTTP) o el nombre: nunca cuerpos ni datos.
    const msg = err instanceof Error && err.message.startsWith("Clerk") ? err.message : err instanceof Error ? err.name : "error";
    console.error(`backfill clientes falló: ${msg}`);
    process.exit(1);
  });
}
