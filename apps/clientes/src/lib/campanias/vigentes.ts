/**
 * Qué campañas de precios están activas (spec apps/admin/docs/superpowers/specs/
 * 2026-10-28-campanias-precios-design.md). Mismo patrón que `flagsPublicos()`: se evalúa por
 * request, AFUERA de los scopes cacheados, y las activas viajan como argumento a las funciones de
 * `catalogo-publico.ts`. Así la clave de la caché cambia sola en el minuto de inicio y de fin: sin
 * cron ni aviso del CRM en los bordes, y la vigencia nunca se calcula adentro de `use cache`.
 *
 * Las ventanas se leen de `campanias_shop` (cacheadas con el tag del catálogo, que vence con el
 * aviso del CRM al guardar una campaña). Si la lectura falla, no hay campañas: el catálogo se ve
 * con su precio normal y el cobro coincide (degrada sin romper).
 */
import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { connection } from "next/server";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { crmCampanias } from "@/db/crm";
import { conRespaldoSinCache } from "../cache-respaldo";
import { TAG_CATALOGO } from "../cache-tags";
import { shopTenantId } from "../tenant";
import type { ContextoCampania } from "./precio";

export interface CampaniaShop {
  id: string;
  nombre: string;
  etiqueta: string;
  inicio: string;
  fin: string;
}

/** Lo que necesita la exhibición de una campaña activa (nombre, badge y cuenta regresiva). */
export interface CampaniaActiva {
  id: string;
  nombre: string;
  etiqueta: string;
  fin: string;
}

/** Las activas en `fecha` (inicio inclusivo, fin exclusivo), ordenadas por id: van en la clave. */
export function idsActivasEn(campanias: readonly CampaniaShop[], fecha: Date): CampaniaActiva[] {
  const t = fecha.getTime();
  return campanias
    .filter((c) => new Date(c.inicio).getTime() <= t && t < new Date(c.fin).getTime())
    .map(({ id, nombre, etiqueta, fin }) => ({ id, nombre, etiqueta, fin }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Las activas → el contexto de `resolverPrecioVigente` (sin unidades: las agrega quien las cuenta). */
export function contextoDe(activas: readonly CampaniaActiva[]): ContextoCampania {
  return { activas: new Set(activas.map((c) => c.id)) };
}

async function leerCampanias(): Promise<CampaniaShop[]> {
  const filas = await getDb()
    .select({
      id: crmCampanias.id,
      nombre: crmCampanias.nombre,
      etiqueta: crmCampanias.etiqueta,
      inicio: crmCampanias.inicio,
      fin: crmCampanias.fin,
    })
    .from(crmCampanias)
    .where(eq(crmCampanias.tenantId, shopTenantId()))
    .orderBy(asc(crmCampanias.inicio));
  // El driver devuelve timestamptz en formato de Postgres: se normaliza a ISO para comparar y mostrar.
  return filas.map((f) => ({ ...f, inicio: new Date(f.inicio).toISOString(), fin: new Date(f.fin).toISOString() }));
}

async function campaniasCacheadas(): Promise<CampaniaShop[]> {
  "use cache: remote";
  cacheTag(TAG_CATALOGO);
  cacheLife("catalogo");
  return leerCampanias();
}

async function campaniasSinFallar(): Promise<CampaniaShop[]> {
  try {
    return await conRespaldoSinCache("campanias", campaniasCacheadas, leerCampanias);
  } catch (err) {
    console.warn("[campanias] no se pudieron leer las campañas:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Todas las ventanas de `campanias_shop` (programadas, activas y terminadas hace < 24 h), cacheadas:
 * para asociar la sección Promociones de la home a una campaña y armar su selector.
 */
export const campaniasShop = cache(async (): Promise<CampaniaShop[]> => campaniasSinFallar());

/** Las campañas activas AHORA. Nunca llamar adentro de `'use cache'`: lee el reloj del request. */
export const campaniasVigentes = cache(async (): Promise<CampaniaActiva[]> => {
  const campanias = await campaniasSinFallar();
  await connection();
  return idsActivasEn(campanias, new Date());
});

/**
 * Las activas en otro instante (recotizar un pedido ya creado: rige la fecha de creación). Lee sin
 * caché: lo usa sólo el checkout.
 */
export async function campaniasActivasEn(fecha: Date): Promise<CampaniaActiva[]> {
  try {
    return idsActivasEn(await leerCampanias(), fecha);
  } catch (err) {
    console.warn("[campanias] no se pudieron leer las campañas:", err instanceof Error ? err.message : err);
    return [];
  }
}
