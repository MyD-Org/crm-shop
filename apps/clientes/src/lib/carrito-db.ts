/**
 * Carrito por usuario de Clerk (`shop.carts`). SOLO servidor (usa la base).
 *
 * Toda consulta pasa por `deEsteUsuario`: tenant del entorno + usuario de
 * Clerk (el mismo patrón que `favoritos.ts` y `direcciones-envio-db.ts`). El
 * usuario lo decide SIEMPRE quien llama con la sesión (`auth()`), nunca el body.
 *
 * Concurrencia optimista: `version` sube en 1 con cada escritura y el reemplazo
 * sólo aplica si trae la versión vigente. Si no, no se toca nada y se devuelve
 * el carrito actual para que el cliente lo adopte.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { carts } from "@/db/schema";
import { getProductosPorIds } from "./catalog";
import {
  mergeMax,
  normalizarCarrito,
  type AvisoCarrito,
  type CartItem,
  type LineaCarrito,
} from "./carrito-cliente";
import { shopTenantId } from "./tenant";

type Db = ReturnType<typeof getDb>;
/** La transacción expone la misma API de consultas que el cliente. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type CarritoServidor = { items: LineaCarrito[]; version: number };

export type ResultadoReemplazo =
  | { ok: true; carrito: CarritoServidor; avisos: AvisoCarrito[] }
  | { ok: false; actual: CarritoServidor };

const t = carts;
const VACIO: CarritoServidor = { items: [], version: 0 };
const COLUMNAS = { items: t.items, version: t.version };
const siguienteVersion = sql`${t.version} + 1`;

function deEsteUsuario(clerkUserId: string) {
  return and(eq(t.tenantId, shopTenantId()), eq(t.clerkUserId, clerkUserId));
}

/**
 * Lo guardado en el jsonb se re-normaliza al leer: una fila editada a mano (o
 * de una versión anterior) no llega rota al cliente.
 */
function lineasGuardadas(raw: unknown): LineaCarrito[] {
  if (!Array.isArray(raw)) return [];
  const lineas = raw.flatMap((i): LineaCarrito[] => {
    if (!i || typeof i !== "object") return [];
    const { id, qty } = i as { id?: unknown; qty?: unknown };
    return typeof id === "string" && typeof qty === "number" ? [{ id, qty }] : [];
  });
  return normalizarCarrito(lineas).items;
}

async function leerCon(db: Db | Tx, clerkUserId: string): Promise<CarritoServidor> {
  const [fila] = await db.select(COLUMNAS).from(t).where(deEsteUsuario(clerkUserId)).limit(1);
  return fila ? { items: lineasGuardadas(fila.items), version: fila.version } : VACIO;
}

/** El carrito del usuario; sin fila, vacío en versión 0. */
export async function leerCarrito(clerkUserId: string): Promise<CarritoServidor> {
  return leerCon(getDb(), clerkUserId);
}

/**
 * Reemplaza el carrito entero si `version` es la vigente. Normaliza antes de
 * escribir (duplicados suman, topes con aviso).
 *
 * Con `version = 0` y sin fila, el primer guardado inserta en versión 1; si
 * otra pestaña insertó en el medio, el `on conflict do nothing` no devuelve
 * fila y cae en el conflicto como cualquier versión vieja.
 */
export async function reemplazarCarrito(
  clerkUserId: string,
  version: number,
  entrada: readonly LineaCarrito[],
): Promise<ResultadoReemplazo> {
  const { items, avisos } = normalizarCarrito(entrada);
  const db = getDb();

  const [actualizada] = await db
    .update(t)
    .set({ items, version: siguienteVersion, updatedAt: new Date() })
    .where(and(deEsteUsuario(clerkUserId), eq(t.version, version)))
    .returning({ version: t.version });
  if (actualizada) return { ok: true, carrito: { items, version: actualizada.version }, avisos };

  if (version === 0) {
    const [creada] = await db
      .insert(t)
      .values({ tenantId: shopTenantId(), clerkUserId, items, version: 1 })
      .onConflictDoNothing({ target: [t.tenantId, t.clerkUserId] })
      .returning({ version: t.version });
    if (creada) return { ok: true, carrito: { items, version: creada.version }, avisos };
  }

  return { ok: false, actual: await leerCon(db, clerkUserId) };
}

/**
 * Une el carrito de invitado con el del servidor (cantidad máxima por
 * producto), de forma atómica: asegura la fila, la bloquea con `for update` y
 * escribe dentro de la misma transacción. Siempre sube la versión, aunque el
 * resultado no cambie (el merge es idempotente; la versión no).
 */
export async function mergearCarrito(
  clerkUserId: string,
  invitado: readonly LineaCarrito[],
): Promise<CarritoServidor & { avisos: AvisoCarrito[] }> {
  return getDb().transaction(async (tx) => {
    // Sin esta fila previa, dos primeros merges simultáneos no tendrían nada
    // que bloquear y chocarían en el insert.
    await tx
      .insert(t)
      .values({ tenantId: shopTenantId(), clerkUserId, items: [], version: 0 })
      .onConflictDoNothing({ target: [t.tenantId, t.clerkUserId] });

    const [fila] = await tx
      .select(COLUMNAS)
      .from(t)
      .where(deEsteUsuario(clerkUserId))
      .limit(1)
      .for("update");

    const { items, avisos } = mergeMax(lineasGuardadas(fila?.items), invitado);

    const [actualizada] = await tx
      .update(t)
      .set({ items, version: siguienteVersion, updatedAt: new Date() })
      .where(deEsteUsuario(clerkUserId))
      .returning({ version: t.version });
    if (!actualizada) throw new Error("El carrito desapareció durante el merge");

    return { items, version: actualizada.version, avisos };
  });
}

/**
 * Vacía el carrito del usuario dentro de la transacción de `crearPedido`. No
 * borra la fila: con `version + 1`, un dispositivo con una versión vieja recibe
 * conflicto y adopta el carrito vacío. Sin fila, no hace nada.
 */
export async function vaciarCarritoTx(tx: Tx | Db, clerkUserId: string): Promise<void> {
  await tx
    .update(t)
    .set({ items: [], version: siguienteVersion, updatedAt: new Date() })
    .where(deEsteUsuario(clerkUserId));
}

/**
 * Nombre, marca y precio referencial del espejo del catálogo (con la lista de
 * precios del cliente). Sin `soloActivos`: un producto despublicado sigue en el
 * carrito y la cotización lo marca. Los que ya no están en el espejo se
 * devuelven con `faltante: true`, no desaparecen en silencio.
 */
export async function enriquecer(
  lineas: readonly LineaCarrito[],
  idPriceList: string | undefined,
): Promise<CartItem[]> {
  if (lineas.length === 0) return [];
  const productos = await getProductosPorIds(
    lineas.map((l) => l.id),
    { idPriceList },
  );
  return lineas.map(({ id, qty }) => {
    const p = productos.get(id);
    return p
      ? { id, qty, name: p.name, brand: p.brand, price: p.price }
      : { id, qty, name: "", brand: "", price: 0, faltante: true };
  });
}
