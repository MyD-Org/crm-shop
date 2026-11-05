/**
 * ¿Se puede pedir el aviso de reingreso de un producto? SOLO servidor. Es la verificación del lado
 * servidor de la regla de la ficha: el `alegra_id` que llega del navegador no es de fiar.
 *
 * Elegible = existe y se vende en la tienda (activo, no oculto, no padre), tiene precio, es
 * inventariable (stock NULL = nunca), NO tiene una modalidad de venta sin stock activa (la ficha no
 * lo muestra "agotado") y el disponible es 0. "Disponible" = stock bruto − reservado, sumado sobre las
 * sucursales vendibles (activas y donde el producto no está oculto); sin sucursales, el stock de la
 * vista del CRM menos lo reservado. Reusa `leerDisponibilidadBruta` y `disponibleNeto`, las mismas
 * piezas que `disponibilidadDe`, así que "agotado" y "disponible" coinciden con la ficha.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { crmCatalogo } from "@/db/crm";
import { stockReservado } from "@/db/schema";
import { mapPrecios } from "./alegra";
import { enTenantCatalogo } from "./catalogo-fuente";
import { disponibleNeto } from "./sucursales-disponibilidad";
import type { SucursalDato } from "./sucursales";
import { activoSql, joinReserva } from "./stock-disponible";
import { leerDisponibilidadBruta, type DisponibilidadBruta } from "./stock-sucursal";
import type { VentaSinStock } from "./venta-sin-stock";

export type MotivoNoElegible = "no_existe" | "no_comprable" | "no_inventariable" | "a_pedido" | "con_disponible";
export type Elegibilidad = { ok: true } | { ok: false; motivo: MotivoNoElegible };

/**
 * Disponible total de un producto sumado sobre las sucursales vendibles. `null` = no inventariable.
 * Pura: el stock bruto, lo reservado y el ocultamiento llegan como datos.
 */
export function disponibleTotal(
  bruta: Pick<DisponibilidadBruta, "stockPorSucursal" | "reservadoPorSucursal" | "ocultoEn">,
  id: string,
  activas: string[],
): number | null {
  const stock = bruta.stockPorSucursal[id];
  if (stock === null) return null;
  const ocultas = bruta.ocultoEn[id] ?? [];
  return activas
    .filter((s) => !ocultas.includes(s))
    .reduce((suma, s) => suma + (disponibleNeto(stock, bruta.reservadoPorSucursal[id], s) ?? 0), 0);
}

/**
 * `sucursales` y `modalidades` llegan de las cachés de la app (`sucursalesCacheadas`,
 * `modalidadesActivas`): este módulo solo lee la base.
 */
export async function elegibleParaAviso(
  alegraId: string,
  datos: { sucursales: SucursalDato[]; modalidades: readonly VentaSinStock[] },
  db: ReturnType<typeof getDb> = getDb(),
): Promise<Elegibilidad> {
  const [fila] = await db
    .select({
      tipo: crmCatalogo.tipo,
      stock: crmCatalogo.stock,
      precios: crmCatalogo.preciosAlegra,
      reservado: stockReservado.qty,
    })
    .from(crmCatalogo)
    .leftJoin(stockReservado, joinReserva())
    .where(and(enTenantCatalogo(), eq(crmCatalogo.alegraId, alegraId), activoSql));
  if (!fila || fila.tipo === "padre") return { ok: false, motivo: "no_existe" };
  if (!mapPrecios(fila.precios).some((p) => p.price > 0)) return { ok: false, motivo: "no_comprable" };
  if (fila.stock == null) return { ok: false, motivo: "no_inventariable" };

  const activas = datos.sucursales
    .filter((s) => s.activa)
    .sort((a, b) => a.orden - b.orden || a.slug.localeCompare(b.slug))
    .map((s) => s.slug);
  const bruta = await leerDisponibilidadBruta([alegraId], activas, activas[0] ?? "", db, false, datos.modalidades);
  if (bruta.ventaSinStock[alegraId]) return { ok: false, motivo: "a_pedido" };

  const disponible =
    activas.length > 0
      ? disponibleTotal(bruta, alegraId, activas)
      : Math.max(0, Number(fila.stock) - Number(fila.reservado ?? 0));
  if (disponible === null) return { ok: false, motivo: "no_inventariable" };
  return disponible > 0 ? { ok: false, motivo: "con_disponible" } : { ok: true };
}
