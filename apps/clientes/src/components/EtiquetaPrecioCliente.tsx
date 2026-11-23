import type { Product } from "@/data/products";
import { esPrecioDeCliente } from "@/lib/precio-cliente";
import { TEXTOS_PRECIOS_CLIENTE } from "@/lib/precios-cliente-textos";

/**
 * "Su precio de cliente", chica y en acento, debajo del precio de las cards (slot `installments` de
 * `ProductCard`, sin cambios en el DS). Sólo cuando el precio que se ve es el de su lista privada
 * (sin campaña que le gane). Sin lista privada no dibuja nada: la card queda igual que siempre.
 */
export function EtiquetaPrecioCliente({ producto }: { producto: Pick<Product, "precioCuenta" | "campania"> }) {
  if (!esPrecioDeCliente(producto)) return null;
  return <span className="block text-xs font-semibold leading-snug text-accent">{TEXTOS_PRECIOS_CLIENTE.etiqueta}</span>;
}
