/**
 * Universo del catálogo para la línea base (lo usan el banco, para el snapshot
 * de la cabecera, y la cobertura de atributos). Una fila por producto del
 * tenant; la agregación es TS puro (testeable con fixtures) y la lectura es UN
 * SELECT con el builder de drizzle que reusa los fragmentos del Shop
 * (`stockSql`/`activoSql`/`joinReserva`/`joinOverlay`/`enTenantCatalogo`,
 * `conStock`, `conPrecioSql`): cero reglas de visibilidad o stock propias.
 *
 * "Publicado" = misma regla que la lista pública con el flag
 * `catalogo-solo-visibles` prendido: activo, overlay visible y con precio.
 * "Con stock" = disponible (stock menos reservado; sin control de stock cuenta
 * como disponible). Todo corre en la transacción read only de `enLectura`.
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { stockReservado } from "@/db/schema";
import { crmCatalogo, crmOverlay } from "@/db/crm";
import { conPrecioSql, conStock } from "@/lib/catalog";
import { enTenantCatalogo } from "@/lib/catalogo-fuente";
import { joinOverlay } from "@/lib/nombre-exhibido";
import { activoSql, joinReserva } from "@/lib/stock-disponible";
import { hashArbol } from "@/lib/busqueda-inteligente/cache";
import type { NodoArbol } from "@/lib/busqueda-inteligente/tipos";

export interface FilaUniverso {
  alegraId: string;
  activo: boolean;
  tieneOverlay: boolean;
  /** Overlay visible (sin overlay = no visible). */
  visible: boolean;
  /** Categoría propia asignada en el CRM; `null` = sin categoría. */
  categoriaId: string | null;
  /** Stock disponible (o sin control de stock). */
  conStock: boolean;
  /** Precio de lista mayor a 0. */
  conPrecio: boolean;
}

export const esPublicado = (f: FilaUniverso): boolean => f.activo && f.visible && f.conPrecio;

export interface ResumenUniverso {
  /** Productos activos. */
  activos: number;
  /** Activos, visibles y con precio. */
  publicados: number;
  /** Activos con stock disponible. */
  conStock: number;
  /** Publicados con stock disponible (el denominador de las coberturas). */
  publicadosConStock: number;
  /** Activos sin fila de overlay. */
  sinOverlay: number;
  /** Activos sin categoría propia (con o sin overlay). */
  sinCategoria: number;
}

/** Los inactivos no cuentan en ningún número. */
export function resumirUniverso(filas: readonly FilaUniverso[]): ResumenUniverso {
  const activos = filas.filter((f) => f.activo);
  return {
    activos: activos.length,
    publicados: activos.filter(esPublicado).length,
    conStock: activos.filter((f) => f.conStock).length,
    publicadosConStock: activos.filter((f) => esPublicado(f) && f.conStock).length,
    sinOverlay: activos.filter((f) => !f.tieneOverlay).length,
    sinCategoria: activos.filter((f) => f.categoriaId === null).length,
  };
}

/** Una fila por producto del tenant. Llamar DENTRO de `enLectura` (usa `getDb()`). */
export async function cargarFilasUniverso(): Promise<FilaUniverso[]> {
  return getDb()
    .select({
      alegraId: crmCatalogo.alegraId,
      activo: sql<boolean>`${activoSql}`,
      tieneOverlay: sql<boolean>`${crmOverlay.id} is not null`,
      visible: sql<boolean>`coalesce(${crmOverlay.visible}, false)`,
      categoriaId: crmOverlay.categoriaId,
      conStock: sql<boolean>`${conStock()}`,
      conPrecio: sql<boolean>`${conPrecioSql}`,
    })
    .from(crmCatalogo)
    .leftJoin(crmOverlay, joinOverlay())
    .leftJoin(stockReservado, joinReserva())
    .where(enTenantCatalogo());
}

export interface SnapshotCatalogo {
  /** Conteos del universo, o `no_disponible` con el motivo (nunca el error crudo). */
  universo: ResumenUniverso | { no_disponible: string };
  categorias: number;
  /** Hash del árbol de categorías activo (el mismo que usa la caché de planes). */
  arbolHash: string;
  /** La búsqueda usa `catalog_atributos` (flag `busqueda-ia` + tabla legible). */
  estructurados: boolean;
}

/**
 * Snapshot del catálogo para la cabecera de una corrida. Si la lectura del
 * universo falla (tabla ausente, permisos) NO rompe: lo declara `no_disponible`.
 * El motivo es sólo el tipo de error: el mensaje puede traer datos de conexión.
 */
export async function snapshotCatalogo(
  arbol: readonly NodoArbol[],
  estructurados: boolean,
  cargar: () => Promise<FilaUniverso[]> = cargarFilasUniverso,
): Promise<SnapshotCatalogo> {
  let universo: SnapshotCatalogo["universo"];
  try {
    universo = resumirUniverso(await cargar());
  } catch (err) {
    universo = { no_disponible: `no se pudo leer el universo del catálogo (${err instanceof Error ? err.name : "error"})` };
  }
  return { universo, categorias: arbol.length, arbolHash: hashArbol(arbol), estructurados };
}
