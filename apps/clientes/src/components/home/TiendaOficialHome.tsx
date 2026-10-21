import Link from "next/link";
import { connection } from "next/server";
import type { TiendaOficialContent } from "@/data/home-defaults";
import { TarjetaProductoCarrusel } from "@/components/TarjetaProductoCarrusel";
import { ImagenMarca } from "@/components/marcas/ImagenMarca";
import { propsTemaOficial } from "@/components/marcas/tema-oficial";
import { destacadosHome } from "@/lib/catalogo-publico";
import { flagsPublicos } from "@/lib/flags-publicos";
import { getPaginaMarca } from "@/lib/marcas/marcas-datos";
import { hrefMarca } from "@/lib/marcas/pagina-marca";
import { filtrosDeMarca } from "@/lib/marcas/vista-marca";
import { dispCatalogo } from "@/lib/zona-servidor";

/**
 * Bloque "Tienda oficial" de la home (spec 2026-10-20-marcas-tienda-oficial §9):
 * negro con el acento de la marca, sello, logo, título y botón a la izquierda;
 * 3 productos de la marca a la derecha. Hueco por request (flags y catálogo).
 * Sin página de marca "oficial" publicada para el `slug`: no dibuja nada.
 */
export async function TiendaOficialHome({ contenido }: { contenido: TiendaOficialContent }) {
  if (!contenido.slug) return null;
  await connection();
  const pagina = await getPaginaMarca(contenido.slug);
  if (!pagina || !pagina.publicada || pagina.nivel !== "oficial") return null;

  const [{ soloVisibles, variantes, mediosPrecio }, disp] = await Promise.all([flagsPublicos(), dispCatalogo()]);
  const productos = await destacadosHome({
    skus: contenido.skus,
    cantidad: 3,
    soloVisibles,
    ...(variantes ? { agrupar: true } : {}),
    disp,
    destacado: mediosPrecio?.destacado,
    cuotas: mediosPrecio?.cuotas,
    base: filtrosDeMarca(pagina),
  });
  const titulo = contenido.titulo || pagina.bajada;

  return (
    <section className="pt-[clamp(56px,7vw,96px)]">
      <div
        {...propsTemaOficial(pagina)}
        className="grid overflow-hidden rounded-2xl lg:grid-cols-[1.1fr_1.6fr]"
      >
        <div className="flex flex-col justify-center gap-4 p-[clamp(24px,3vw,40px)]">
          <span className="self-start rounded-full border border-accent px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            Tienda oficial
          </span>
          {pagina.logo ? (
            <span className="relative block h-16 w-40 rounded-lg bg-white p-2">
              <ImagenMarca src={pagina.logo} alt={`Logo de ${pagina.nombre}`} sizes="160px" fit="logo" className="h-full w-full object-contain" />
            </span>
          ) : (
            <span className="font-display text-2xl font-semibold tracking-[0.12em] text-text">{pagina.nombre}</span>
          )}
          {titulo ? (
            <p className="font-display text-[clamp(22px,2.4vw,30px)] font-light leading-snug text-text">{titulo}</p>
          ) : null}
          <Link
            href={hrefMarca(pagina.slug)}
            className="inline-flex items-center justify-center self-start rounded-md bg-accent px-5 py-3 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90"
          >
            {contenido.cta} →
          </Link>
        </div>
        {productos.length > 0 ? (
          <ul className="grid grid-cols-2 gap-3 bg-surface p-[clamp(12px,2vw,24px)] sm:grid-cols-3">
            {productos.slice(0, 3).map((p, i) => (
              <li key={p.id} className={i === 2 ? "max-sm:hidden" : undefined}>
                <TarjetaProductoCarrusel producto={p} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
