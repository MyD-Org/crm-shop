/**
 * Lo que el cron del aviso de reingreso necesita saber de los productos con avisos pendientes
 * (change `aviso-reingreso`, S2). SOLO servidor.
 *
 * - `hayDisponible`: de una lista de productos, cuáles tienen disponible > 0. "Disponible" es la
 *   misma regla que la ficha y que `elegibleParaAviso`: stock bruto − reservado por sucursal, sumado
 *   sobre las sucursales vendibles (`disponibleTotal`), así "agotado" y "disponible" coinciden. Nunca
 *   el stock bruto. Sin sucursales activas, stock de la vista − reservado. Stock NULL = no
 *   inventariable: no cuenta como reingreso. En tandas de `TANDA_DISPONIBILIDAD` ids.
 * - `productosAvisables`: nombre y opción de los productos que HOY se ven en la tienda (activos, no
 *   ocultos, no padre). Un producto oculto o dado de baja no se avisa: el enlace del mail iría a un 404.
 */
import { and, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { crmCatalogo } from "@/db/crm";
import { stockReservado } from "@/db/schema";
import { enTenantCatalogo } from "./catalogo-fuente";
import { disponibleTotal } from "./aviso-reingreso-elegibilidad";
import { TANDA_DISPONIBILIDAD } from "./aviso-reingreso-textos";
import { activoSql, joinReserva, stockSql } from "./stock-disponible";
import { leerDisponibilidadBruta } from "./stock-sucursal";
import type { SucursalDato } from "./sucursales";

type Db = ReturnType<typeof getDb>;

function tandas<T>(lista: T[], tamano: number): T[][] {
  const salida: T[][] = [];
  for (let i = 0; i < lista.length; i += tamano) salida.push(lista.slice(i, i + tamano));
  return salida;
}

/** `sucursales` llega de la caché de la app (`sucursalesCacheadas`): este módulo solo lee la base. */
export async function hayDisponible(
  ids: string[],
  datos: { sucursales: SucursalDato[] },
  db: Db = getDb(),
): Promise<Set<string>> {
  const unicos = [...new Set(ids)];
  const disponibles = new Set<string>();
  if (unicos.length === 0) return disponibles;

  const activas = datos.sucursales
    .filter((s) => s.activa)
    .sort((a, b) => a.orden - b.orden || a.slug.localeCompare(b.slug))
    .map((s) => s.slug);

  for (const tanda of tandas(unicos, TANDA_DISPONIBILIDAD)) {
    if (activas.length > 0) {
      const bruta = await leerDisponibilidadBruta(tanda, activas, activas[0], db, false, []);
      for (const id of tanda) {
        const total = disponibleTotal(bruta, id, activas);
        if (total !== null && total > 0) disponibles.add(id);
      }
    } else {
      const filas = await db
        .select({ alegraId: crmCatalogo.alegraId, disponible: stockSql })
        .from(crmCatalogo)
        .leftJoin(stockReservado, joinReserva())
        .where(and(enTenantCatalogo(), inArray(crmCatalogo.alegraId, tanda)));
      for (const f of filas) if (f.disponible != null && Number(f.disponible) > 0) disponibles.add(f.alegraId);
    }
  }
  return disponibles;
}

export interface ProductoAvisable {
  nombre: string;
  /** Texto de la opción ("Blanco cálido") si es una variante; null en un producto suelto. */
  etiqueta: string | null;
}

/** Nombre del producto tal como se lee en el mail: "Lámpara — Blanco cálido" si es una variante. */
export function nombreConOpcion(p: ProductoAvisable): string {
  return p.etiqueta && !p.nombre.includes(p.etiqueta) ? `${p.nombre} — ${p.etiqueta}` : p.nombre;
}

export async function productosAvisables(
  ids: string[],
  db: Db = getDb(),
): Promise<Map<string, ProductoAvisable>> {
  const mapa = new Map<string, ProductoAvisable>();
  for (const tanda of tandas([...new Set(ids)], TANDA_DISPONIBILIDAD)) {
    const filas = await db
      .select({ alegraId: crmCatalogo.alegraId, nombre: crmCatalogo.name, etiqueta: crmCatalogo.etiqueta, tipo: crmCatalogo.tipo })
      .from(crmCatalogo)
      .where(and(enTenantCatalogo(), inArray(crmCatalogo.alegraId, tanda), activoSql));
    for (const f of filas) {
      if (f.tipo === "padre") continue;
      mapa.set(f.alegraId, { nombre: f.nombre, etiqueta: f.etiqueta?.trim() || null });
    }
  }
  return mapa;
}
