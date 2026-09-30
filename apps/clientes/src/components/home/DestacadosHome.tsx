import { connection } from "next/server";
import { ProductCardSkeleton } from "@myd-org/ui";
import { ProductosCarrusel } from "@/components/ProductosCarrusel";
import { TarjetaProductoCarrusel } from "@/components/TarjetaProductoCarrusel";
import { getOfertaCuotas } from "@/lib/cuotas-datos";
import { destacadosHome } from "@/lib/catalogo-publico";
import { dispCatalogo } from "@/lib/zona-servidor";
import { flagsPublicos } from "@/lib/flags-publicos";

interface PropsCarrusel {
  /** Nombre accesible del carrusel (título de la sección, sin marcas de acento). */
  label: string;
  /** Cuántos productos muestra la sección (config del editor). */
  cantidad: number;
}

/**
 * Productos destacados de la home: hueco por request dentro del shell (los
 * flags `catalogo-solo-visibles` y `cuotas` se evalúan acá, nunca en el
 * shell). Lo que viene del contenido cacheado de la home (SKUs curados,
 * cantidad, imágenes propias) lo pasa el padre por props.
 *
 * Los productos salen de `destacadosHome` (caché compartida, tag `catalogo`:
 * se renueva al terminar la sync del CRM o a los 15 minutos) y la oferta de
 * cuotas de su propia caché. Los SKUs curados desde el editor se resuelven
 * primero; el resto se completa con Iluminación (héroes temáticos de la
 * tienda), nunca hardcodeados.
 */
export async function DestacadosHome({
  label,
  cantidad,
  skus,
  imagenes,
}: PropsCarrusel & {
  skus: string[];
  /** Imágenes propias de la sección, por posición. */
  imagenes: string[];
}) {
  // Por request (flags): sin lecturas en el prerender.
  await connection();
  // Si el catálogo falla, `destacadosHome` degrada a destacados vacíos (la
  // sección ya renderiza la grilla vacía) en vez de tumbar la página entera.
  const [{ soloVisibles }, disp] = await Promise.all([flagsPublicos(), dispCatalogo()]);
  const [oferta, destacados] = await Promise.all([
    getOfertaCuotas(),
    destacadosHome({ skus, cantidad, soloVisibles, disp }),
  ]);

  return (
    <ProductosCarrusel label={label}>
      {destacados.map((p, i) => (
        // La imagen decorativa de la sección es por posición (ver home-defaults.ts).
        <TarjetaProductoCarrusel key={p.id} producto={p} oferta={oferta} imagenDecorativa={imagenes[i]} />
      ))}
    </ProductosCarrusel>
  );
}

/** Silueta del carrusel mientras llegan los destacados (va en el shell). */
export function DestacadosHomeSkeleton({ label, cantidad }: PropsCarrusel) {
  return (
    <ProductosCarrusel label={label}>
      {Array.from({ length: Math.max(1, cantidad) }, (_, i) => (
        <ProductCardSkeleton key={i} variant="editorial" className="h-full" />
      ))}
    </ProductosCarrusel>
  );
}
