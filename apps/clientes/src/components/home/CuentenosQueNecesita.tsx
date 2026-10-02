import Form from "next/form";
import Link from "next/link";
import { connection } from "next/server";
import { AccentText } from "@myd-org/ui";
import { ChispaIcon } from "@/components/catalogo/iconos";
import { Reveal } from "@/components/Reveal";
import { busquedaIaHabilitada } from "@/lib/busqueda-ia-flag";
import { STOCK_INCLUYE_SIN_STOCK } from "@/lib/catalogo-url";
import { RUTA_BUSCAR, hrefBuscar } from "@/lib/busqueda-v2/enlaces";
import { TEXTOS_CUENTENOS } from "@/lib/iniciativa/textos";
import {
  clasesVisibilidad,
  sinCamposOcultos,
  sinItemsOcultos,
  type BusquedaAsistidaContent,
  type Visibilidad,
} from "@/data/home-defaults";
import { SeccionEditable } from "./SeccionEditable";

/**
 * "Cuéntenos qué necesita" (spec catálogo asistido fase 2, §3): un campo que
 * manda a `/buscar` (la búsqueda v2 entiende la frase y redirige al
 * catálogo) y tres ejemplos que se tocan. No depende del chat: sale con el
 * flag `busqueda-ia`, que es el que hace que una frase encuentre algo.
 *
 * Misma URL que el buscador del header (`hrefBuscar`: `q` y todos los
 * productos, no sólo los con stock), así la home y el header muestran lo
 * mismo. `next/form`: el envío navega del lado del cliente (el router sigue
 * el 307 de `/buscar`) y sin JS es un `<form method="get">` común.
 *
 * Textos y ejemplos editables desde la home (sección `busquedaAsistida`); la
 * etiqueta y el botón quedan fijos en `TEXTOS_CUENTENOS`.
 */
export function CuentenosQueNecesita({ contenido }: { contenido: BusquedaAsistidaContent }) {
  const { eyebrow, titulo, tituloMobile, bajada, bajadaMobile, placeholder, ejemplosTitulo, visibilidadTextos } =
    sinCamposOcultos(contenido);
  const ejemplos = sinItemsOcultos(contenido.ejemplos);
  // Con `Reveal` como el resto de las secciones de la home.
  return (
    <Reveal>
      <section
        aria-labelledby={titulo || tituloMobile ? "cuentenos-titulo" : undefined}
        aria-label={titulo || tituloMobile ? undefined : TEXTOS_CUENTENOS.etiqueta}
        className="pt-[clamp(56px,7vw,96px)]">
        <div className="relative overflow-hidden rounded-[28px] bg-elevated px-[clamp(20px,4vw,56px)] py-[clamp(28px,4.5vw,60px)]">
          {/* Destello decorativo, en el tono de acento del sitio. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent/15 blur-3xl"
          />
          <div className="relative grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:gap-14">
            <div>
              {eyebrow ? (
                <p
                  className={`mb-3 flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.14em] text-accent ${clasesVisibilidad(visibilidadTextos?.eyebrow)}`}
                >
                  <ChispaIcon className="h-4 w-4 shrink-0" />
                  {eyebrow}
                </p>
              ) : null}
              {/* Sin título visible, el nombre accesible de la sección queda en la etiqueta del campo. */}
              {titulo || tituloMobile ? (
                <h2
                  id="cuentenos-titulo"
                  className={`font-display text-[clamp(28px,3.2vw,42px)] font-bold leading-[1.12] tracking-[-0.02em] text-text ${clasesVisibilidad(visibilidadTextos?.titulo)}`}
                >
                  <AccentText text={titulo ?? ""} mobileText={tituloMobile} accentClassName="not-italic text-accent" />
                </h2>
              ) : null}
              {bajada || bajadaMobile ? (
                <p
                  className={`mt-3 max-w-[46ch] text-[15px] leading-[1.6] text-muted ${clasesVisibilidad(visibilidadTextos?.bajada)}`}
                >
                  <AccentText text={bajada ?? ""} mobileText={bajadaMobile} />
                </p>
              ) : null}
            </div>

            <div className="min-w-0">
              <Form
                action={RUTA_BUSCAR}
                className="flex items-center gap-2 rounded-full border border-border bg-surface p-1.5 pl-5 shadow-[var(--shadow-1)] transition-[border-color,box-shadow] focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15"
              >
                <label htmlFor="cuentenos-q" className="sr-only">
                  {TEXTOS_CUENTENOS.etiqueta}
                </label>
                <input
                  id="cuentenos-q"
                  name="q"
                  type="search"
                  required
                  // Al menos una letra o un número: sólo espacios no es una búsqueda.
                  pattern=".*[\p{L}\p{N}].*"
                  maxLength={120}
                  enterKeyHint="search"
                  autoComplete="off"
                  placeholder={placeholder}
                  className="min-w-0 flex-1 bg-transparent py-2 text-base text-text outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
                />
                <input type="hidden" name="stock" value={STOCK_INCLUYE_SIN_STOCK} />
                <button
                  type="submit"
                  className="shrink-0 rounded-full bg-accent px-5 py-2.5 text-sm font-extrabold text-white transition-colors hover:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {TEXTOS_CUENTENOS.buscar}
                </button>
              </Form>

              {ejemplos.length > 0 ? (
                <div className="mt-4 flex flex-wrap items-center gap-2 pl-1">
                  {ejemplosTitulo ? <span className="text-sm font-semibold text-muted">{ejemplosTitulo}</span> : null}
                  <ul className="flex min-w-0 flex-wrap gap-2">
                    {ejemplos.map(({ texto: ejemplo, visibilidad }, i) => (
                      <li key={`${i}-${ejemplo}`} className={`min-w-0 max-w-full ${clasesVisibilidad(visibilidad)}`}>
                        <Link
                          href={hrefBuscar(ejemplo)}
                          prefetch={false}
                          aria-label={TEXTOS_CUENTENOS.buscarEjemplo(ejemplo)}
                          className="block max-w-full truncate whitespace-nowrap rounded-full border border-border bg-surface px-3 py-1 text-sm text-text transition-colors hover:border-primary hover:text-primary"
                        >
                          {ejemplo}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </Reveal>
  );
}

/**
 * Hueco por request de la home (dentro de `<Suspense fallback={null}>`): el
 * flag se evalúa fuera del shell cacheado. `connection()` primero, como el
 * header: en el prerender no se lee el flag. Si el flag no responde, la home
 * de siempre.
 */
export async function CuentenosSiBusquedaIa({
  contenido,
  visibilidad,
}: {
  contenido: BusquedaAsistidaContent;
  visibilidad: Visibilidad;
}) {
  await connection();
  const habilitada = await busquedaIaHabilitada().catch(() => false);
  if (!habilitada) return null;
  return (
    <SeccionEditable seccion="busquedaAsistida" visibilidad={visibilidad}>
      <CuentenosQueNecesita contenido={contenido} />
    </SeccionEditable>
  );
}
