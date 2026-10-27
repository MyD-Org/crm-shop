/**
 * Lectura de las modalidades de venta sin stock activas (SÓLO servidor).
 * Lectura tolerante: sin la migración 0094 del CRM (tabla o GRANT ausentes) devuelve [] y el Shop
 * se comporta como siempre. Nunca tira.
 */
import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { crmModalidadesSinStock } from "@/db/crm";
import { shopTenantId } from "./tenant";
import {
  aVentaSinStock,
  type ModalidadSinStock,
  type VentaSinStock,
} from "./venta-sin-stock";

type Lector = Pick<ReturnType<typeof getDb>, "select">;

export async function leerModalidadesActivas(db?: Lector): Promise<ModalidadSinStock[]> {
  try {
    // `getDb()` adentro del try: sin conexión configurada también cae a [].
    const filas = await (db ?? getDb())
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
  } catch (err) {
    console.warn("[venta-sin-stock] modalidades no disponibles:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** Una lectura por request (`cache` de React; fuera de un render no memoriza). Sin `nombre`. */
export const modalidadesActivas = cache(
  async (): Promise<VentaSinStock[]> => (await leerModalidadesActivas()).map(aVentaSinStock),
);
