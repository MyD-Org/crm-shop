/**
 * ¿El Shop puede leer `public.catalog_atributos`? (migración 0049 del CRM + su GRANT por columna).
 *
 * La tabla puede no existir todavía (la migración se aplica a mano) o el permiso puede faltar (el
 * rol se creó después). Una consulta del catálogo que la nombre y falle rompería la tienda entera,
 * así que se pregunta UNA vez con una consulta vacía (`LIMIT 0`: valida tabla y columnas sin leer
 * filas) y el resultado se recuerda un rato por instancia: tras aplicar la migración, el Shop
 * empieza a usarla solo, sin redeploy.
 *
 * Quien llama decide con esto (y con el flag `busqueda-ia`) y le pasa un booleano a la capa de
 * catálogo, que así nunca consulta la tabla a ciegas y lo lleva en la clave de su caché.
 *
 * SOLO servidor.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { crmAtributos } from "@/db/crm";
import { shopTenantId } from "./tenant";

/** Cuánto se recuerda la respuesta (por instancia). */
const TTL_MS = 5 * 60_000;

let memo: { valor: boolean; hasta: number } | null = null;

type Ejecutor = Pick<ReturnType<typeof getDb>, "select">;

export async function atributosEstructuradosDisponibles(
  db?: Ejecutor,
  ahora: number = Date.now(),
): Promise<boolean> {
  if (memo && memo.hasta > ahora) return memo.valor;
  let valor: boolean;
  try {
    // `getDb()` adentro del try: sin conexión configurada también cae a "no disponible".
    await (db ?? getDb())
      .select({
        tenantId: crmAtributos.tenantId,
        alegraId: crmAtributos.alegraId,
        clave: crmAtributos.clave,
        valorNum: crmAtributos.valorNum,
        valorTexto: crmAtributos.valorTexto,
      })
      .from(crmAtributos)
      // Con el tenant, como toda lectura de `public` (y `LIMIT 0`: no trae filas).
      .where(eq(crmAtributos.tenantId, shopTenantId()))
      .limit(0);
    valor = true;
  } catch (err) {
    console.warn(
      "[catalogo-atributos] catalog_atributos no disponible; se usan los patrones del nombre:",
      err instanceof Error ? err.message : err,
    );
    valor = false;
  }
  memo = { valor, hasta: ahora + TTL_MS };
  return valor;
}

/** Sólo tests. */
export function reiniciarDisponibilidadAtributos(): void {
  memo = null;
}
