/**
 * Lectura de las modalidades de venta sin stock activas (SÓLO servidor).
 * Lectura tolerante: sin la migración 0094 del CRM (tabla o GRANT ausentes) devuelve [] y el Shop
 * se comporta como siempre. Nunca tira.
 *
 * - `leerModalidadesActivas(db?)`: lectura SIN caché. Es la que usa `crearPedido` dentro de la
 *   transacción (la decisión que escribe un pedido nunca sale de la caché).
 * - `modalidadesActivas()`: para mostrar y cotizar. Sale de `'use cache: remote'` con el tag
 *   `catalogo` y el perfil `catalogo` (como las lecturas de `catalogo-publico.ts`): el aviso del CRM
 *   al guardar una modalidad o una asignación (`avisarShop` → `/api/internal/catalogo/revalidar`) la
 *   vence al instante; si se pierde, vence sola a los 15 minutos. Así cada cotización (y cada
 *   recotización de cuotas, totales y bases) no vuelve a pegarle a la base. Si la caché misma falla,
 *   se lee sin caché (`conRespaldoSinCache`).
 */
import { cacheLife, cacheTag } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { crmModalidadesSinStock } from "@/db/crm";
import { conRespaldoSinCache } from "./cache-respaldo";
import { TAG_CATALOGO } from "./cache-tags";
import { shopTenantId } from "./tenant";
import {
  aVentaSinStock,
  type ModalidadSinStock,
  type VentaSinStock,
} from "./venta-sin-stock";

type Lector = Pick<ReturnType<typeof getDb>, "select">;

/** ¿Postgres 42P01 (tabla inexistente) o 42501 (sin permiso)? Mira también `cause` (drizzle envuelve). */
function esTablaAusenteOSinPermiso(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 4; e = (e as { cause?: unknown }).cause, i++) {
    const code = (e as { code?: unknown }).code;
    if (code === "42P01" || code === "42501") return true;
  }
  return false;
}

/** Tira ante cualquier error (la tolerancia la pone quien llama). */
async function leerModalidades(db: Lector): Promise<ModalidadSinStock[]> {
  const filas = await db
    .select({
      id: crmModalidadesSinStock.id,
      nombre: crmModalidadesSinStock.nombre,
      texto: crmModalidadesSinStock.texto,
      plazoDias: crmModalidadesSinStock.plazoDias,
      flujo: crmModalidadesSinStock.flujo,
    })
    .from(crmModalidadesSinStock)
    .where(and(eq(crmModalidadesSinStock.tenantId, shopTenantId()), eq(crmModalidadesSinStock.activa, true)));
  const validas: ModalidadSinStock[] = [];
  for (const f of filas) {
    const flujoOk = f.flujo === "en_linea" || f.flujo === "a_confirmar";
    const plazoOk = f.plazoDias === null || (Number.isInteger(f.plazoDias) && f.plazoDias >= 1 && f.plazoDias <= 60);
    if (!flujoOk || !plazoOk) continue;
    validas.push({
      id: f.id,
      nombre: f.nombre,
      texto: f.texto,
      plazoDias: f.plazoDias,
      flujo: f.flujo as ModalidadSinStock["flujo"],
    });
  }
  return validas;
}

/**
 * Sin la migración 0094 (tabla o GRANT ausentes: 42P01 / 42501) es un aviso: el Shop sigue como
 * siempre. Cualquier otro error es una falla real (base caída, columna renombrada): `console.error`.
 */
function registrarFalla(err: unknown): void {
  const detalle = err instanceof Error ? err.message : err;
  if (esTablaAusenteOSinPermiso(err)) console.warn("[venta-sin-stock] modalidades no disponibles:", detalle);
  else console.error("[venta-sin-stock] no se pudieron leer las modalidades:", detalle);
}

export async function leerModalidadesActivas(db?: Lector): Promise<ModalidadSinStock[]> {
  try {
    // `getDb()` adentro del try: sin conexión configurada también cae a [].
    return await leerModalidades(db ?? getDb());
  } catch (err) {
    registrarFalla(err);
    return [];
  }
}

/** Modalidades activas para mostrar y cotizar (caché `catalogo`, ver arriba). Sin `nombre`. */
export function modalidadesActivas(): Promise<VentaSinStock[]> {
  return conRespaldoSinCache("modalidades-sin-stock", modalidadesDeCache, async () =>
    (await leerModalidadesActivas()).map(aVentaSinStock),
  );
}

async function modalidadesDeCache(): Promise<VentaSinStock[]> {
  "use cache: remote";
  cacheTag(TAG_CATALOGO);
  try {
    const modalidades = (await leerModalidades(getDb())).map(aVentaSinStock);
    cacheLife("catalogo");
    return modalidades;
  } catch (err) {
    // Una falla (o la migración sin aplicar) no se guarda por 15 minutos: perfil `degradado`.
    registrarFalla(err);
    cacheLife("degradado");
    return [];
  }
}
