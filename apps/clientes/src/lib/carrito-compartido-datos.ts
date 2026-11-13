/**
 * Productos de un carrito compartido, resueltos para quien ABRE el link: con
 * SU lista privada si la tiene, igual que `/api/carrito` (el carrito después muestra lo
 * mismo). SOLO servidor: usa la DB.
 *
 * A diferencia de `enriquecer()` (carrito-db.ts), sólo cuenta los productos
 * activos y publicados: un carrito compartido no debería meter en el carrito
 * de otro algo que la tienda ya no vende.
 */

import { campaniasVigentes } from "./campanias/vigentes";
import { SIN_MEDIOS_PRECIO, type MedioPrecio } from "./medios-precio";
import { mediosOfrecibles } from "@/lib/medios-pago-datos";
import { esCompradorCuentaCorriente } from "@/lib/medios-pago";
import { SLUG_TRANSFERENCIA } from "@/lib/cuentas-bancarias";
import { pagoParaCotizar } from "@/lib/lista-medio";
import { ubicacionDelVisitante } from "@/lib/ubicacion-servidor";
import { entregaDelCarrito } from "@/lib/entrega-eleccion";
import { identidadActual } from "@/lib/auth";
import { listaPrivadaDelComprador } from "@/lib/lista-cuenta-repo";
import { preciosPrivados } from "@/lib/precios-privados-repo";
import { precioFinal } from "@/lib/precio-final";
import { getProductosPorIds } from "@/lib/catalog";
import { catalogoSoloVisibles } from "@/lib/catalogo-flag";
import { variantesSelector } from "@/lib/variantes-flag";
import { nombreDeLinea } from "@/lib/nombre-linea";
import type { CartItem, LineaCarrito } from "@/lib/carrito-cliente";

export interface ProductoCompartido {
  /** Listo para `addItems` / `replaceItems`. `price` es el NETO, como en el carrito. */
  item: CartItem;
  /** Unitario para mostrar: con IVA si se conoce, como en la ficha. Con transferencia, el de ese medio. */
  precioExhibido: number;
  /** Con transferencia: el unitario con los demás medios, sólo si es mayor que `precioExhibido`. */
  precioOtrosMedios?: number;
}

export interface CarritoCompartidoResuelto {
  productos: ProductoCompartido[];
  /** Los precios son con transferencia (medio activo con lista propia), como en el carrito. */
  conTransferencia: boolean;
}

/**
 * El medio Transferencia con lista propia, con la MISMA regla que `/carrito` (page.tsx): activo, que
 * aplique a la modalidad elegida y con lista. Cuenta corriente o lista privada no: su precio no
 * depende del medio. Si algo falla, sin transferencia (precio general).
 */
async function medioTransferencia(conPrecioPropio: boolean): Promise<MedioPrecio | null> {
  if (conPrecioPropio) return null;
  try {
    const medios = await mediosOfrecibles();
    const transferencia = medios.find((m) => m.slug === SLUG_TRANSFERENCIA && m.activo);
    if (!transferencia) return null;
    const eleccion = (await ubicacionDelVisitante().catch(() => null))?.eleccion ?? { tipo: "ninguna" as const };
    const { entregaTipo } = entregaDelCarrito(eleccion);
    const pago = pagoParaCotizar(medios, entregaTipo, transferencia);
    if (!pago.pagoMetodo || !pago.listaKey) return null;
    return { slug: transferencia.slug, nombre: transferencia.nombre, idListaPrecios: pago.listaKey };
  } catch {
    return null;
  }
}

export async function productosCompartidos(
  lineas: readonly LineaCarrito[],
): Promise<CarritoCompartidoResuelto> {
  if (lineas.length === 0) return { productos: [], conTransferencia: false };
  const [{ cliente }, soloVisibles, agrupar, campanias] = await Promise.all([
    identidadActual(),
    catalogoSoloVisibles(),
    variantesSelector(),
    campaniasVigentes(),
  ]);
  const idListaPrivada = cliente ? await listaPrivadaDelComprador() : null;
  const transferencia = await medioTransferencia(esCompradorCuentaCorriente(cliente) || Boolean(idListaPrivada));
  const mediosPrecio =
    campanias.length || transferencia ? { ...SIN_MEDIOS_PRECIO, campanias, destacado: transferencia } : null;
  const ids = lineas.map((l) => l.id);
  const [productos, privados] = await Promise.all([
    getProductosPorIds(ids, {
      soloActivos: true,
      soloVisibles,
      ...(agrupar ? { agrupar: true } : {}),
      ...(mediosPrecio ? { mediosPrecio } : {}),
    }),
    idListaPrivada ? preciosPrivados(idListaPrivada, ids) : Promise.resolve(null),
  ]);
  const resueltos = lineas.map(({ id, qty }): ProductoCompartido => {
    const p = productos.get(id);
    if (!p) {
      return {
        item: { id, qty, name: "Producto no disponible", brand: "", price: 0, faltante: true },
        precioExhibido: 0,
      };
    }
    // Con lista privada: su neto (0 = sin precio en su lista, "Consulte") y su final con IVA; si una
    // campaña de precios lo deja más barato, el de campaña (decisión B: paga el menor).
    const privado = privados ? (privados.get(id) ?? 0) : undefined;
    const neto = privado === undefined ? p.price : p.campania && privado > 0 && p.price < privado ? p.price : privado;
    const exhibido = privados && neto !== p.price ? (precioFinal(neto, p.ivaPorcentaje) ?? neto) : (p.precioFinal ?? p.price);
    const item = { id, qty, name: nombreDeLinea(p), brand: p.brand, price: neto, image: p.images?.[0]?.url };
    // Con transferencia: su precio (la card lo trae sólo si es menor que el general); si no, el general,
    // igual que la cotización del carrito con la lista del medio.
    const medio = transferencia && p.precioMedio?.slug === transferencia.slug ? p.precioMedio : null;
    const conMedio = medio ? (medio.precioFinal ?? medio.price) : null;
    if (conMedio !== null && conMedio < exhibido) {
      return { item, precioExhibido: conMedio, precioOtrosMedios: exhibido };
    }
    return { item, precioExhibido: exhibido };
  });
  return { productos: resueltos, conTransferencia: Boolean(transferencia) };
}
