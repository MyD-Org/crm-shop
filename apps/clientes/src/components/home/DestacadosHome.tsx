import Link from "next/link";
import Image from "next/image";
import { connection } from "next/server";
import { Badge, ProductCard, ProductCardSkeleton } from "@myd-org/ui";
import { AddToCartButton } from "@/components/AddToCartButton";
import { BotonFavorito } from "@/components/BotonFavorito";
import { CuotasCard } from "@/components/CuotasCard";
import { ProductosCarrusel } from "@/components/ProductosCarrusel";
import { mejorOpcionPara } from "@/lib/cuotas-exhibicion";
import { getOfertaCuotas } from "@/lib/cuotas-datos";
import { destacadosHome } from "@/lib/catalogo-publico";
import { flagsPublicos } from "@/lib/flags-publicos";

function LightbulbIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
    </svg>
  );
}

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
  const { soloVisibles } = await flagsPublicos();
  const [oferta, destacados] = await Promise.all([
    getOfertaCuotas(),
    destacadosHome({ skus, cantidad, soloVisibles }),
  ]);

  return (
    <ProductosCarrusel label={label}>
      {destacados.map((p, i) => {
        const imagen = imagenes[i];
        return (
          <Link
            key={p.id}
            href={`/producto/${p.id}`}
            className="block transition-transform duration-300 hover:-translate-y-1"
          >
            <ProductCard
              variant="editorial"
              className="h-full overflow-hidden"
              name={p.name}
              brand={p.brand}
              price={p.precioFinal ?? p.price}
              oldPrice={p.oldPrice}
              badge={p.badgeText ? <Badge tone={p.badgeTone}>{p.badgeText}</Badge> : undefined}
              // La card entera es un <Link>: el corazón corta la navegación.
              cornerAction={<BotonFavorito productId={p.id} dentroDeLink />}
              image={
                imagen ? (
                  <Image
                    src={imagen}
                    alt={p.name}
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                    className="object-cover"
                  />
                ) : (
                  <LightbulbIcon className="h-20 w-20 text-muted/30" />
                )
              }
              priceNote={p.sku ? `Cód. ${p.sku}` : undefined}
              actionPlacement="below"
              action={
                <AddToCartButton
                  product={{ id: p.id, name: p.name, brand: p.brand, price: p.price }}
                />
              }
              installments={<CuotasCard opcion={mejorOpcionPara(p.precioFinal, oferta)} />}
            />
          </Link>
        );
      })}
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
