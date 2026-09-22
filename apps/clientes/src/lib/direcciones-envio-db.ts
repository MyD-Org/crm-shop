/**
 * Direcciones de envío de Mi cuenta. SOLO servidor (usa la base).
 *
 * Toda consulta pasa por `deEsteUsuario`: tenant del entorno + usuario de
 * Clerk, al leer, escribir y borrar (el mismo patrón que `favoritos.ts`). Una
 * dirección ajena o inexistente se comporta igual: `null` / `false`, y la API
 * lo traduce a un 404 uniforme.
 *
 * La base garantiza una sola predeterminada por usuario (índice único parcial
 * de `0003`). Por eso cambiarla es siempre "desmarcar la anterior y después
 * marcar la nueva", en una transacción.
 */
import { and, count, desc, eq, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { direccionesEnvio } from "@/db/schema";
import { MAX_DIRECCIONES, type DatosDireccion, type DireccionEnvio } from "./direcciones-envio";
import { shopTenantId } from "./tenant";

/** El usuario ya tiene `MAX_DIRECCIONES`: la API lo traduce a 422. */
export class DireccionesLlenasError extends Error {
  constructor() {
    super(`Se alcanzó el máximo de ${MAX_DIRECCIONES} direcciones.`);
    this.name = "DireccionesLlenasError";
  }
}

type Db = ReturnType<typeof getDb>;
/** La transacción expone la misma API de consultas que el cliente. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const t = direccionesEnvio;

/** Columnas que ve la UI (sin tenant, usuario ni fechas). */
const COLUMNAS = {
  id: t.id,
  etiqueta: t.etiqueta,
  calle: t.calle,
  ciudad: t.ciudad,
  provincia: t.provincia,
  cp: t.cp,
  referencias: t.referencias,
  predeterminada: t.predeterminada,
};

function deEsteUsuario(clerkUserId: string) {
  return and(eq(t.tenantId, shopTenantId()), eq(t.clerkUserId, clerkUserId));
}

function laSuya(clerkUserId: string, id: string) {
  return and(deEsteUsuario(clerkUserId), eq(t.id, id));
}

/** Columnas editables a partir de los datos validados. */
function camposEditables(datos: DatosDireccion) {
  return {
    etiqueta: datos.etiqueta,
    calle: datos.calle,
    ciudad: datos.ciudad,
    provincia: datos.provincia,
    cp: datos.cp,
    referencias: datos.referencias,
  };
}

/** Desmarca la predeterminada actual del usuario (salvo `excepto`). */
async function desmarcarPredeterminada(tx: Tx | Db, clerkUserId: string, excepto?: string) {
  await tx
    .update(t)
    .set({ predeterminada: false, updatedAt: new Date() })
    .where(
      and(
        deEsteUsuario(clerkUserId),
        eq(t.predeterminada, true),
        excepto ? ne(t.id, excepto) : undefined,
      ),
    );
}

/** Marca `id` como predeterminada. Llamar después de desmarcar la anterior. */
async function marcar(tx: Tx | Db, clerkUserId: string, id: string) {
  await tx
    .update(t)
    .set({ predeterminada: true, updatedAt: new Date() })
    .where(laSuya(clerkUserId, id));
}

/** Las direcciones del usuario: la predeterminada primero, después la más nueva. */
export async function listarDirecciones(clerkUserId: string): Promise<DireccionEnvio[]> {
  return getDb()
    .select(COLUMNAS)
    .from(t)
    .where(deEsteUsuario(clerkUserId))
    .orderBy(desc(t.predeterminada), desc(t.createdAt))
    .limit(MAX_DIRECCIONES);
}

/**
 * Guarda una dirección nueva. La primera del usuario queda predeterminada
 * sola; las siguientes, sólo si se pide. En el tope lanza
 * `DireccionesLlenasError` sin escribir.
 *
 * Dos altas simultáneas pueden pasar el conteo a la vez (11 filas) o, siendo
 * las dos la primera, chocar contra el índice único parcial (una falla con
 * 500). Es un techo contra el abuso y una carrera de un solo usuario consigo
 * mismo: no justifica un lock.
 */
export async function crearDireccion(
  clerkUserId: string,
  datos: DatosDireccion,
): Promise<DireccionEnvio> {
  return getDb().transaction(async (tx) => {
    const [estado] = await tx.select({ n: count() }).from(t).where(deEsteUsuario(clerkUserId));
    const n = Number(estado?.n ?? 0);
    if (n >= MAX_DIRECCIONES) throw new DireccionesLlenasError();

    const predeterminada = n === 0 || datos.predeterminada;
    if (predeterminada && n > 0) await desmarcarPredeterminada(tx, clerkUserId);

    const [creada] = await tx
      .insert(t)
      .values({
        tenantId: shopTenantId(),
        clerkUserId,
        ...camposEditables(datos),
        predeterminada,
      })
      .returning(COLUMNAS);
    return creada;
  });
}

/**
 * Edita una dirección del usuario. `null` si no existe o es ajena. La marca de
 * predeterminada sólo cambia si se pide (`true`): desmarcarla no existe, se
 * elige otra.
 */
export async function actualizarDireccion(
  clerkUserId: string,
  id: string,
  datos: DatosDireccion,
): Promise<DireccionEnvio | null> {
  return getDb().transaction(async (tx) => {
    const [fila] = await tx
      .update(t)
      .set({ ...camposEditables(datos), updatedAt: new Date() })
      .where(laSuya(clerkUserId, id))
      .returning(COLUMNAS);
    if (!fila) return null;
    if (datos.predeterminada && !fila.predeterminada) {
      await desmarcarPredeterminada(tx, clerkUserId, id);
      await marcar(tx, clerkUserId, id);
      return { ...fila, predeterminada: true };
    }
    return fila;
  });
}

/**
 * Borra una dirección del usuario. `false` si no existe o es ajena. Si era la
 * predeterminada, pasa a serlo la más reciente de las que quedan.
 */
export async function eliminarDireccion(clerkUserId: string, id: string): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [borrada] = await tx
      .delete(t)
      .where(laSuya(clerkUserId, id))
      .returning({ predeterminada: t.predeterminada });
    if (!borrada) return false;
    if (borrada.predeterminada) {
      const [siguiente] = await tx
        .select({ id: t.id })
        .from(t)
        .where(deEsteUsuario(clerkUserId))
        .orderBy(desc(t.createdAt))
        .limit(1);
      if (siguiente) await marcar(tx, clerkUserId, siguiente.id);
    }
    return true;
  });
}

/** Deja `id` como la predeterminada del usuario. `false` si no existe o es ajena. */
export async function marcarPredeterminada(clerkUserId: string, id: string): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [existe] = await tx.select({ id: t.id }).from(t).where(laSuya(clerkUserId, id)).limit(1);
    if (!existe) return false;
    await desmarcarPredeterminada(tx, clerkUserId, id);
    await marcar(tx, clerkUserId, id);
    return true;
  });
}
