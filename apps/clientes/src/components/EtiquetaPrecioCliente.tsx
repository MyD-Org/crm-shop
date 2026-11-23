import type { Product } from "@/data/products";
import { esPrecioDeCliente, porcentajeAhorro } from "@/lib/precio-cliente";
import { TEXTOS_PRECIOS_CLIENTE } from "@/lib/precios-cliente-textos";

/**
 * "N% menos" chico y en verde, debajo del precio de las cards (slot `installments` de
 * `ProductCard`, sin cambios en el DS), cuando su precio de cliente es menor que el general tachado.
 * Que son precios de cliente ya lo dice el aviso de la tienda: la card no lo repite. Sin lista
 * privada, sin tachado o con campaña no dibuja nada.
 */
export function EtiquetaPrecioCliente({
  producto,
}: {
  producto: Pick<Product, "precioCuenta" | "campania" | "price" | "precioFinal" | "oldPrice">;
}) {
  if (!esPrecioDeCliente(producto)) return null;
  const pct = porcentajeAhorro(producto.precioFinal ?? producto.price, producto.oldPrice);
  if (pct == null) return null;
  return <span className="block text-xs font-semibold leading-snug text-success">{TEXTOS_PRECIOS_CLIENTE.ahorro(pct)}</span>;
}
