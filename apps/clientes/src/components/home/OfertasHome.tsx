import Link from "next/link";
import type { Product } from "@/data/products";
import { ProductosCarrusel } from "@/components/ProductosCarrusel";
import { TarjetaProductoCarrusel } from "@/components/TarjetaProductoCarrusel";
import type { CampaniaActiva } from "@/lib/campanias/vigentes";
import { paginaOfertasPublica } from "@/lib/catalogo-publico";
import { HREF_OFERTAS } from "@/lib/catalogo-url";
import type { ContextoDisponibilidad } from "@/lib/disponibilidad-contexto";
import type { MediosPrecio } from "@/lib/medios-precio";

/** Textos del bloque de ofertas de la home (usted). */
export const TEXTOS_OFERTAS_HOME = {
  cinta: "Ofertas",
  titulo: "Precios especiales por tiempo limitado",
  verTodas: "Ver todas las ofertas",
} as const;

/** Cuántas ofertas muestra el bloque (las de mayor descuento, con stock). */
export const CANTIDAD_OFERTAS_HOME = 8;

/**
 * Las ofertas del bloque: «Solo ofertas» con stock, por mayor descuento, de la caché del catálogo
 * (las campañas activas son parte de la clave). Si la base falla, ninguna: el bloque no se dibuja.
 */
export async function ofertasParaHome(args: {
  soloVisibles: boolean;
  agrupar: boolean;
  disp: ContextoDisponibilidad | undefined;
  mediosPrecio: MediosPrecio | undefined;
  campanias: CampaniaActiva[];
}): Promise<Product[]> {
  if (args.campanias.length === 0) return [];
  try {
    const { productos } = await paginaOfertasPublica({
      soloVisibles: args.soloVisibles,
      ...(args.agrupar ? { agrupar: true } : {}),
      disp: args.disp,
      destacado: args.mediosPrecio?.destacado,
      cuotas: args.mediosPrecio?.cuotas,
      campanias: args.campanias,
    });
    return productos.slice(0, CANTIDAD_OFERTAS_HOME);
  } catch (err) {
    console.error("[OfertasHome] no se pudieron cargar las ofertas:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Bloque «Precios especiales por tiempo limitado» (diseño «Ofertas más llamativas», punto 2): banda
 * en el color de la marca, cinta en el resaltado, las ofertas de mayor descuento con la misma card
 * del catálogo (borde y pestaña de campaña) y «Ver todas las ofertas». Sin productos, nada.
 */
export function OfertasHomeVista({ productos }: { productos: Product[] }) {
  if (productos.length === 0) return null;
  return (
    <section data-ofertas-home="" aria-labelledby="ofertas-home-titulo" className="rounded-[28px] bg-primary px-[clamp(16px,3vw,32px)] py-[clamp(20px,3vw,32px)] text-on-primary">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col items-start gap-2">
          <span className="rounded-full bg-highlight px-3 py-1 font-display text-xs font-extrabold uppercase tracking-wider text-text">
            {TEXTOS_OFERTAS_HOME.cinta}
          </span>
          <h2 id="ofertas-home-titulo" className="font-display text-2xl font-extrabold tracking-tight md:text-3xl">
            {TEXTOS_OFERTAS_HOME.titulo}
          </h2>
        </div>
        <Link
          href={HREF_OFERTAS}
          className="rounded-full bg-surface px-5 py-2.5 text-sm font-bold text-text transition-colors hover:bg-elevated"
        >
          {TEXTOS_OFERTAS_HOME.verTodas}
        </Link>
      </div>
      <ProductosCarrusel label={TEXTOS_OFERTAS_HOME.titulo} perView={4}>
        {productos.map((p) => (
          <TarjetaProductoCarrusel key={p.id} producto={p} />
        ))}
      </ProductosCarrusel>
    </section>
  );
}
