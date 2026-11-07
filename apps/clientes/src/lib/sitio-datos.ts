/**
 * Lectura de `tenants.shop_destinos_extra` (SOLO servidor, sin caché propia: la llaman las
 * funciones `'use cache'` de la marca y el tema). La columna la concede la migración 0100 del CRM:
 * si falta el permiso o la columna, lanza y quien llama degrada a la marca de entorno.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { crmTenants } from "@/db/crm";
import { shopTenantId } from "@/lib/tenant";

/** Valor crudo de `shop_destinos_extra` (null si no hay fila). */
export async function leerDestinosExtra(): Promise<unknown> {
  const [fila] = await getDb()
    .select({ shopDestinosExtra: crmTenants.shopDestinosExtra })
    .from(crmTenants)
    .where(eq(crmTenants.id, shopTenantId()))
    .limit(1);
  return fila?.shopDestinosExtra ?? null;
}
