import { and, eq, inArray, like, notLike, sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { getDb } from "@/db";
import { homeContent } from "@/db/schema";
import { TAG_MARCA } from "@/lib/cache-tags";
import { claveSitio, resolverSitioPorClave } from "@/lib/sitio";
import { leerDestinosExtra } from "@/lib/sitio-datos";
import { shopTenantId } from "@/lib/tenant";

/**
 * CHOKEPOINT de `home_content`: ningún otro módulo consulta la tabla.
 *
 * Un sitio con marca propia (ver `sitio.ts`) guarda y lee sus filas bajo `sitio:<etiqueta>:<key>`;
 * el principal y los alias usan las claves sin prefijo. Todas las funciones reciben y devuelven
 * claves SIN prefijo, y un sitio propio nunca lee filas del principal (la única excepción es
 * `leerWhatsappDelPrincipal`, que expone un solo campo). El sitio sale de `claveSitio()` salvo que
 * quien llama pase el suyo (las funciones `'use cache'` lo reciben como argumento).
 */
const PREFIJO_SITIO = "sitio:";

function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Etiqueta del sitio propio, o null si es el principal o un alias. Si no se puede leer
 * `shop_destinos_extra` LANZA: ante la duda no se cae al espacio del principal.
 */
async function etiquetaPropia(sitio: string): Promise<string | null> {
  "use cache";
  cacheTag(TAG_MARCA);
  // Sin sitio en el entorno ni override: es el principal, no hace falta leer los extras.
  if (sitio === "|") return null;
  const resuelto = resolverSitioPorClave(sitio, await leerDestinosExtra());
  cacheLife("marca");
  return resuelto.propio ? resuelto.etiqueta : null;
}

/** Prefijo de las claves del sitio ("" para el principal y los alias). */
async function prefijoDe(sitio: string): Promise<string> {
  const etiqueta = await etiquetaPropia(sitio);
  return etiqueta === null ? "" : `${PREFIJO_SITIO}${etiqueta}:`;
}

/**
 * Todas las funciones de este módulo acotan por `shopTenantId()`: la tabla es de todas las tiendas
 * que comparten la base.
 *
 * Upsert de una sección de home. Llaman las server actions de
 * `home-acciones.ts` (editor in-place de la home). `payload === null`
 * (navBadge apagado) se persiste como jsonb 'null': borrar la fila NO apaga
 * el badge, vuelve el default (que sí lo trae).
 */
export async function guardarSeccionHome(
  key: string,
  payload: unknown,
  sitio: string = claveSitio(),
): Promise<{ updatedAt: Date }> {
  // La columna es jsonb NOT NULL: un `null` de JS iría como SQL NULL y
  // fallaría. `sql\`'null'::jsonb\`` es el jsonb "null" válido.
  const valor =
    payload === null
      ? sql`'null'::jsonb`
      : (payload as Record<string, unknown>);
  const tenantId = shopTenantId();
  const claveReal = `${await prefijoDe(sitio)}${key}`;
  const [fila] = await getDb()
    .insert(homeContent)
    .values({ tenantId, key: claveReal, payload: valor as unknown as Record<string, unknown> })
    .onConflictDoUpdate({
      target: [homeContent.tenantId, homeContent.key],
      set: { payload: valor as unknown as Record<string, unknown>, updatedAt: new Date() },
    })
    .returning({ updatedAt: homeContent.updatedAt });
  return fila;
}

/** Elimina la fila de una sección (vuelve al default). */
export async function borrarSeccionHome(key: string, sitio: string = claveSitio()): Promise<void> {
  const claveReal = `${await prefijoDe(sitio)}${key}`;
  await getDb()
    .delete(homeContent)
    .where(and(eq(homeContent.tenantId, shopTenantId()), eq(homeContent.key, claveReal)));
}

/** Payload crudo de una sección, o `undefined` si no tiene fila. */
export async function leerSeccionHome(key: string, sitio: string = claveSitio()): Promise<unknown> {
  const claveReal = `${await prefijoDe(sitio)}${key}`;
  const [fila] = await getDb()
    .select({ payload: homeContent.payload })
    .from(homeContent)
    .where(and(eq(homeContent.tenantId, shopTenantId()), eq(homeContent.key, claveReal)));
  return fila?.payload;
}

/**
 * Payload crudo de varias secciones en una sola consulta (las que no tienen
 * fila no aparecen en el mapa). La usa el layout para el footer: datos
 * legales + contenido del footer sin pagar dos idas a la DB.
 */
export async function leerSeccionesHome(
  keys: readonly string[],
  sitio: string = claveSitio(),
): Promise<Map<string, unknown>> {
  const prefijo = await prefijoDe(sitio);
  const filas = await getDb()
    .select({ key: homeContent.key, payload: homeContent.payload })
    .from(homeContent)
    .where(
      and(
        eq(homeContent.tenantId, shopTenantId()),
        inArray(homeContent.key, keys.map((k) => `${prefijo}${k}`)),
      ),
    );
  return new Map(filas.map((f) => [f.key.slice(prefijo.length), f.payload]));
}

/**
 * Payload crudo de todas las filas cuya clave empieza con `prefijo` (por
 * ejemplo `pagina-marca:`). El prefijo se escapa para el `like` (`\`, `%` y
 * `_` son literales), así una clave no puede abrir la consulta a otras filas.
 */
export async function leerSeccionesHomePorPrefijo(
  prefijo: string,
  sitio: string = claveSitio(),
): Promise<Map<string, unknown>> {
  const delSitio = await prefijoDe(sitio);
  const patron = `${escaparLike(`${delSitio}${prefijo}`)}%`;
  const filas = await getDb()
    .select({ key: homeContent.key, payload: homeContent.payload })
    .from(homeContent)
    .where(and(eq(homeContent.tenantId, shopTenantId()), like(homeContent.key, patron)));
  return new Map(filas.map((f) => [f.key.slice(delSitio.length), f.payload]));
}

/**
 * Todas las filas del sitio (la home). El principal y los alias no ven las filas de los sitios
 * propios (`sitio:%`); un sitio propio ve sólo las suyas.
 */
export async function leerTodasSeccionesHome(
  sitio: string = claveSitio(),
): Promise<{ key: string; payload: unknown }[]> {
  const prefijo = await prefijoDe(sitio);
  const delTenant = eq(homeContent.tenantId, shopTenantId());
  const filtro = prefijo
    ? and(delTenant, like(homeContent.key, `${escaparLike(prefijo)}%`))
    : and(delTenant, notLike(homeContent.key, `${PREFIJO_SITIO}%`));
  const filas = await getDb()
    .select({ key: homeContent.key, payload: homeContent.payload })
    .from(homeContent)
    .where(filtro);
  return filas.map((f) => ({ key: f.key.slice(prefijo.length), payload: f.payload }));
}

/**
 * WhatsApp del footer del principal. Es la ÚNICA lectura del espacio del principal que hace un
 * sitio propio: devuelve sólo ese campo (el número se comparte entre los sitios), ningún otro.
 */
export async function leerWhatsappDelPrincipal(): Promise<string> {
  const [fila] = await getDb()
    .select({ payload: homeContent.payload })
    .from(homeContent)
    .where(and(eq(homeContent.tenantId, shopTenantId()), eq(homeContent.key, "footer")));
  const p = fila?.payload;
  const numero = p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>).whatsapp : undefined;
  return typeof numero === "string" ? numero.trim() : "";
}
