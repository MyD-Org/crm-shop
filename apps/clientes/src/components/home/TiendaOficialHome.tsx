import { campaniasVigentes } from "@/lib/campanias/vigentes";
import Link from "next/link";
import { connection } from "next/server";
import type { TiendaOficialContent } from "@/data/home-defaults";
import { TarjetaProductoCarrusel } from "@/components/TarjetaProductoCarrusel";
import { ImagenMarca } from "@/components/marcas/ImagenMarca";
import { LogoMarca } from "@/components/marcas/logo-marca";
import { propsTemaOficial } from "@/components/marcas/tema-oficial";
import { atributoEstudio } from "@/components/marcas/estudio-fotos";
import { destacadosHome } from "@/lib/catalogo-publico";
import { flagsPublicos } from "@/lib/flags-publicos";
import { getPaginaMarca } from "@/lib/marcas/marcas-datos";
import { hrefMarca, temaDe } from "@/lib/marcas/pagina-marca";
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

  const [{ soloVisibles, variantes, mediosPrecio }, disp, campanias] = await Promise.all([
    flagsPublicos(),
    dispCatalogo(),
    campaniasVigentes(),
  ]);
  const productos = await destacadosHome({
    skus: contenido.skus,
    cantidad: 3,
    soloVisibles,
    ...(variantes ? { agrupar: true } : {}),
    disp,
    destacado: mediosPrecio?.destacado,
    cuotas: mediosPrecio?.cuotas,
    campanias,
    base: filtrosDeMarca(pagina),
  });
  const titulo = contenido.titulo || pagina.bajada;
  // La foto propia del bloque o, si no, la del encabezado de la página de marca.
  const foto = contenido.imagen || pagina.bloques.hero?.imagen;
  const fotoAlt = (contenido.imagen ? contenido.imagenAlt : pagina.bloques.hero?.imagenAlt) ?? "";

  return (
    <section className="pt-[clamp(56px,7vw,96px)]">
      <div
        {...propsTemaOficial(pagina)}
        className="grid overflow-hidden rounded-2xl lg:grid-cols-[1.1fr_1.6fr]"
      >
        {/* Panel izquierdo: arriba el chip y el logo, abajo el título y el botón; el centro queda
            libre para la foto. El velo oscurece arriba y abajo (donde va el texto), no el medio. */}
        <div className="relative isolate flex min-h-[320px] flex-col justify-between gap-8 overflow-hidden p-[clamp(20px,2.6vw,36px)]">
          {foto ? (
            <>
              <ImagenMarca src={foto} alt={fotoAlt} sizes="(max-width: 1024px) 100vw, 40vw" fit="cover" className="-z-10 object-cover" />
              <div
                aria-hidden
                className={
                  temaDe(pagina) === "claro"
                    ? "absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(250,249,246,0.92)_0%,rgba(250,249,246,0.35)_38%,rgba(250,249,246,0.35)_58%,rgba(250,249,246,0.94)_100%)]"
                    : "absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(10,10,12,0.88)_0%,rgba(10,10,12,0.3)_38%,rgba(10,10,12,0.3)_58%,rgba(10,10,12,0.92)_100%)]"
                }
              />
            </>
          ) : null}
          <div className="flex flex-col items-start gap-3">
            <span className="rounded-full border border-accent px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
              Tienda oficial
            </span>
            {pagina.logo ? (
              <LogoMarca src={pagina.logo} nombre={pagina.nombre} fondoOscuro={temaDe(pagina) !== "claro"} className="h-16" />
            ) : (
              <span className="font-display text-2xl font-semibold tracking-[0.12em] text-text">{pagina.nombre}</span>
            )}
          </div>
          <div className="flex flex-col items-start gap-4">
            {titulo ? (
              <p className="max-w-md font-display text-[clamp(20px,2.2vw,28px)] font-light leading-snug text-text">{titulo}</p>
            ) : null}
            <Link
              href={hrefMarca(pagina.slug)}
              className="inline-flex items-center justify-center rounded-md bg-accent px-5 py-3 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90"
            >
              {contenido.cta} →
            </Link>
          </div>
        </div>
        {productos.length > 0 ? (
          <ul
            {...atributoEstudio(pagina.bloques.elegidos?.estiloFotos)}
            data-fotos-con-aire=""
            className="grid grid-cols-2 gap-3 bg-surface p-[clamp(12px,2vw,24px)] sm:grid-cols-3"
          >
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
