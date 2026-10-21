import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@myd-org/ui";
import type {
  ComponentesMarca,
  ConfianzaMarca,
  CotizacionMarca,
  HeroMarca,
  LineasMarca,
  ObrasMarca,
  PaginaMarca,
} from "@/lib/marcas/pagina-marca";
import { hrefLinea } from "@/lib/marcas/vista-marca";
import { ImagenMarca } from "../ImagenMarca";

/**
 * Bloques estáticos de una página de marca (spec 2026-10-20 §3 y §4). Server
 * Components: el contenido sale de la `PaginaMarca` cacheada. Los que dependen
 * del catálogo (elegidos, productos) van aparte, en huecos por request.
 */

const ANCHO = "mx-auto w-full max-w-contenido px-[clamp(18px,4vw,48px)]";
const ETIQUETA = "text-[11px] font-semibold uppercase tracking-[0.18em]";

export function SeccionMarca({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("py-[clamp(32px,5vw,64px)]", className)}>
      <div className={ANCHO}>{children}</div>
    </section>
  );
}

export function TituloBloque({ children, bajada }: { children: ReactNode; bajada?: string }) {
  return (
    <div className="mb-6">
      <h2 className="font-display text-[clamp(24px,2.6vw,34px)] font-light leading-tight tracking-[-0.01em] text-text">
        {children}
      </h2>
      {bajada ? <p className="mt-2 max-w-2xl text-base text-muted">{bajada}</p> : null}
    </div>
  );
}

function Logo({ pagina, claro }: { pagina: PaginaMarca; claro: boolean }) {
  if (!pagina.logo) return null;
  return (
    <div
      className={cn(
        "relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl p-3 sm:h-28 sm:w-28",
        claro ? "bg-white" : "border border-border bg-surface",
      )}
    >
      <ImagenMarca src={pagina.logo} alt={`Logo de ${pagina.nombre}`} sizes="112px" fit="logo" className="h-auto max-h-full w-full object-contain" />
    </div>
  );
}

/** Encabezado. Oficial: oscuro, con foto de obra velada y sello. Marca: claro y simple. */
export function HeroMarcaBloque({
  pagina,
  hero,
  total,
}: {
  pagina: PaginaMarca;
  hero: HeroMarca | undefined;
  total: number | null;
}) {
  const cta = hero?.cta ? `${hero.cta}${total ? ` (${total})` : ""}` : null;
  if (pagina.nivel === "marca") {
    return (
      <section className="border-b border-border bg-surface">
        <div className={cn(ANCHO, "flex flex-col gap-5 py-[clamp(28px,4vw,48px)] sm:flex-row sm:items-center")}>
          <Logo pagina={pagina} claro />
          <div className="flex-1">
            <h1 className="font-display text-[clamp(30px,4vw,48px)] font-medium tracking-tight text-text">{pagina.nombre}</h1>
            {pagina.bajada ? <p className="mt-2 max-w-2xl text-base text-muted">{pagina.bajada}</p> : null}
          </div>
          {cta ? (
            <a href="#productos" className="text-sm font-semibold text-accent underline-offset-4 hover:underline">
              {cta} →
            </a>
          ) : null}
        </div>
      </section>
    );
  }
  return (
    <section className="relative isolate overflow-hidden">
      {hero?.imagen ? (
        <ImagenMarca
          src={hero.imagen}
          alt={hero.imagenAlt ?? ""}
          sizes="100vw"
          fit="cover"
          priority
          className="-z-10 object-cover"
        />
      ) : (
        <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_75%_40%,#4a3d22_0%,#17140f_45%,#0a0a0c_80%)]" />
      )}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(10,10,12,0.94)_0%,rgba(10,10,12,0.6)_55%,rgba(10,10,12,0.25)_100%)]"
      />
      <div className={cn(ANCHO, "flex min-h-[clamp(320px,42vw,520px)] flex-col justify-end gap-6 py-[clamp(32px,5vw,64px)] sm:flex-row sm:items-end")}>
        <Logo pagina={pagina} claro />
        <div className="flex-1">
          {hero?.sello ? (
            <span className={cn(ETIQUETA, "mb-3 inline-block rounded-full border border-accent px-3 py-1 text-accent")}>
              {hero.sello}
            </span>
          ) : null}
          <h1 className="font-display text-[clamp(36px,5.5vw,72px)] font-light leading-none tracking-[-0.02em] text-text">
            {pagina.nombre}
          </h1>
          {pagina.bajada ? <p className="mt-4 max-w-xl text-base text-muted sm:text-lg">{pagina.bajada}</p> : null}
        </div>
        {cta ? (
          <a
            href="#productos"
            className="inline-flex items-center justify-center self-start rounded-md bg-accent px-5 py-3 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90 sm:self-end"
          >
            {cta}
          </a>
        ) : null}
      </div>
    </section>
  );
}

export function ConfianzaBloque({ confianza }: { confianza: ConfianzaMarca }) {
  if (confianza.items.length === 0) return null;
  return (
    <section className="border-y border-border bg-bg">
      <dl className={cn(ANCHO, "grid grid-cols-2 lg:grid-cols-4")}>
        {confianza.items.map((i) => (
          <div key={i.valor + i.texto} className="border-border px-2 py-5 [&:not(:last-child)]:lg:border-r">
            <dt className="font-display text-2xl font-light text-accent">{i.valor}</dt>
            <dd className="text-sm text-muted">{i.texto}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function LineasBloque({ pagina, lineas, lineaActual }: { pagina: PaginaMarca; lineas: LineasMarca; lineaActual?: string }) {
  if (lineas.items.length === 0) return null;
  return (
    <SeccionMarca>
      {lineas.titulo ? <TituloBloque>{lineas.titulo}</TituloBloque> : null}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {lineas.items.map((l) => (
          <li key={l.slug}>
            <Link
              href={hrefLinea(pagina.slug, l.slug)}
              scroll={false}
              aria-current={lineaActual === l.slug ? "true" : undefined}
              className={cn(
                "group relative flex h-32 items-end overflow-hidden rounded-lg border border-border bg-elevated p-3 sm:h-40",
                lineaActual === l.slug && "ring-2 ring-accent",
              )}
            >
              {l.imagen ? (
                <ImagenMarca src={l.imagen} alt="" sizes="(max-width: 640px) 50vw, 20vw" fit="cover" className="object-cover transition-transform duration-500 group-hover:scale-105" />
              ) : null}
              <span className="relative rounded bg-bg/85 px-2 py-1 text-sm font-semibold text-text">{l.titulo}</span>
            </Link>
          </li>
        ))}
      </ul>
    </SeccionMarca>
  );
}

export function ComponentesBloque({ componentes }: { componentes: ComponentesMarca }) {
  if (componentes.chips.length === 0) return null;
  return (
    <section className="border-y border-border bg-surface">
      <div className={cn(ANCHO, "grid gap-6 py-[clamp(28px,4vw,48px)] md:grid-cols-[1fr_2fr] md:items-center")}>
        <TituloBloque bajada={componentes.bajada}>{componentes.titulo}</TituloBloque>
        <ul className="flex flex-wrap gap-2">
          {componentes.chips.map((c) => (
            <li key={c} className="rounded-full border border-accent px-3 py-1.5 text-sm text-accent">
              {c}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function ObrasBloque({ obras }: { obras: ObrasMarca }) {
  if (obras.fotos.length === 0) return null;
  return (
    <SeccionMarca>
      <TituloBloque>{obras.titulo}</TituloBloque>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {obras.fotos.map((f, i) => (
          <li key={f.imagen} className={cn("relative overflow-hidden rounded-lg bg-elevated", i === 0 ? "col-span-2 row-span-2 aspect-square md:aspect-auto" : "aspect-[4/3]")}>
            <ImagenMarca src={f.imagen} alt={f.alt} sizes={i === 0 ? "(max-width: 768px) 100vw, 50vw" : "(max-width: 768px) 50vw, 25vw"} fit="cover" className="object-cover" />
            {f.epigrafe ? (
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-6 text-sm text-white">
                {f.epigrafe}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </SeccionMarca>
  );
}

export function CotizacionBloque({ cotizacion, href }: { cotizacion: CotizacionMarca; href: string | null }) {
  if (!href) return null;
  return (
    <section className="bg-surface">
      <div className={cn(ANCHO, "flex flex-col gap-4 py-[clamp(28px,4vw,48px)] md:flex-row md:items-center md:justify-between")}>
        <div>
          <p className="font-display text-[clamp(20px,2.2vw,28px)] font-light text-text">{cotizacion.titulo}</p>
          {cotizacion.bajada ? <p className="mt-1 text-base text-muted">{cotizacion.bajada}</p> : null}
        </div>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center rounded-md bg-accent px-5 py-3 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90"
        >
          {cotizacion.boton} →
        </a>
      </div>
    </section>
  );
}
