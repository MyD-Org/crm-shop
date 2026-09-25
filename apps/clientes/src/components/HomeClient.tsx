import Link from "next/link";
import {
  AccentText,
  CtaBanner,
  Hero,
  Marquee,
  PromoBanner,
  RoomTiles,
  ServiceCard,
} from "@myd-org/ui";
import { Reveal } from "@/components/Reveal";
import { linkNext } from "@/components/catalogo/link-next";
import { imagenNext } from "@/components/catalogo/imagen-next";
import type { ReactNode } from "react";
import {
  aVisibleOn,
  clasesVisibilidad,
  difierePorTamano,
  itemsEn,
  sinCamposOcultos,
  sinItemsOcultos,
  textoVisibleOn,
  visibilidadDe,
  type HomeContent,
  type SeccionHome,
  type SoloEn,
  type TextosSeccion,
  type TileContent,
} from "@/data/home-defaults";
import { SeccionEditable } from "@/components/home/SeccionEditable";
import { InteractiveHero } from "@/components/home/InteractiveHero";
import { isStudioImage, STUDIO_IMAGE } from "@/components/home/hero-lights";

/* ── Icons (mismo criterio que el header: SVG inline, sin deps) ─── */

function TruckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h11v10H3zM14 10h4l3 3v4h-7z" />
      <circle cx="7" cy="17.5" r="1.6" />
      <circle cx="17" cy="17.5" r="1.6" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}
function CreditCardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
const ICONOS_USP = [TruckIcon, CheckIcon, WhatsAppIcon];
const ICONOS_SERVICIO = [TruckIcon, CheckIcon, CreditCardIcon, ChatIcon];

/** El contrato de config (español) al shape del DS (inglés). */
function aTilesDS(items: TileContent[]) {
  return items.map((t) => ({
    eyebrow: t.eyebrow,
    title: t.titulo,
    imageSrc: t.imagen,
    href: t.href,
    overlay: t.velo === "suave" ? ("soft" as const) : t.velo === "fuerte" ? ("strong" as const) : undefined,
  }));
}

/**
 * Pinta la lista una sola vez si todos sus ítems se ven en los dos tamaños; si
 * alguno es solo de mobile o solo de desktop, una versión por tamaño (la otra
 * se oculta por CSS). Así la cinta, el mosaico y la pila se arman con los
 * ítems que de verdad quedan, en vez de dejar huecos.
 */
function PorTamano<T extends { visibilidad?: SoloEn }>({
  items,
  children,
}: {
  items: readonly T[];
  children: (items: T[]) => ReactNode;
}) {
  const visibles = sinItemsOcultos(items);
  if (!difierePorTamano(visibles)) return <>{children(visibles)}</>;
  return (
    <>
      <div className="contents md:hidden">{children(itemsEn(visibles, "mobile"))}</div>
      <div className="contents max-md:hidden">{children(itemsEn(visibles, "desktop"))}</div>
    </>
  );
}

function TituloSeccion({ textos, linkTodos }: { textos: TextosSeccion; linkTodos?: string }) {
  const { titulo, tituloMobile, bajada, bajadaMobile, visibilidadTextos } = textos;
  const hayTitulo = !!(titulo || tituloMobile);
  if (!hayTitulo && !bajada && !bajadaMobile && !linkTodos) return null;
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-6 max-md:flex-col max-md:items-start">
      <div>
        {hayTitulo ? (
          <h2 className={`font-display text-[clamp(28px,3.2vw,42px)] font-bold leading-[1.12] tracking-[-0.02em] text-text ${clasesVisibilidad(visibilidadTextos?.titulo)}`}>
            <AccentText text={titulo ?? ""} mobileText={tituloMobile} accentClassName="not-italic text-accent" />
          </h2>
        ) : null}
        {bajada || bajadaMobile ? (
          <p className={`mt-3 max-w-[52ch] text-[15px] leading-[1.6] text-muted ${clasesVisibilidad(visibilidadTextos?.bajada)}`}>
            <AccentText text={bajada ?? ""} mobileText={bajadaMobile} />
          </p>
        ) : null}
      </div>
      {linkTodos ? (
        <Link
          href={linkTodos}
          className="border-b-[1.5px] border-text pb-[3px] text-[13px] font-extrabold text-text transition-colors hover:border-accent hover:text-accent"
        >
          Ver todos →
        </Link>
      ) : null}
    </div>
  );
}

/**
 * Home sobre el design system. Server component: recibe el contenido (DB
 * mergeada con defaults del diseño aprobado, cacheado en el shell) y el hueco
 * de los destacados reales del catálogo, armados en app/page.tsx.
 *
 * Las correcciones tipográficas entre corchetes ([&_em]:not-italic,
 * [&_h1]:font-bold, tono del primer CTA) alinean el DS al diseño aprobado
 * sin valores numéricos sueltos: el DS hardcodea itálica en los <em>,
 * títulos en medium y el CTA primario en night; el mockup los tiene rectos,
 * en negrita y en acento. Cuando el DS exponga variantes (ctaTone, weight
 * del display, emStyle) estas utilidades se van.
 */
export function HomeClient({
  contenido,
  destacados,
}: {
  contenido: HomeContent;
  /**
   * Carrusel de productos destacados: hueco por request con su `<Suspense>`
   * (precio, stock, cuotas y flags). Lo arma app/page.tsx.
   */
  destacados: ReactNode;
}) {
  const { marquee, servicios } = contenido;
  // Los textos apagados con "Mostrar" no se pintan. El editor no depende de
  // estas props: cada Dialog pide su sección completa al abrirse
  // (`leerSeccionParaEditar`), así la home es la misma para admin y visitante.
  const hero = sinCamposOcultos(contenido.hero);
  const ambientes = sinCamposOcultos(contenido.ambientes);
  const secDestacados = sinCamposOcultos(contenido.destacados);
  const bannerDeco = sinCamposOcultos(contenido.bannerDeco);
  const decoGrid = sinCamposOcultos(contenido.decoGrid);
  const whatsapp = sinCamposOcultos(contenido.whatsapp);
  const vis = (s: SeccionHome) => visibilidadDe(contenido.visibilidad, s);

  // La foto del hero es el LCP de la home: el Hero del DS la pide con
  // `priority` e `imagenNext` la precarga desde el <head> (una sola vez, ya
  // con srcset/sizes del optimizador).
  const imagenHero = isStudioImage(hero.imagen) ? STUDIO_IMAGE : hero.imagen;

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-contenido px-[clamp(18px,4vw,48px)]">
        <div className="pt-[clamp(20px,3vw,36px)]">
          <Reveal>
            <SeccionEditable seccion="hero" visibilidad={vis("hero")}>
              <InteractiveHero enabled={isStudioImage(hero.imagen)}>
              <Hero
                className="[&_em]:not-italic [&_h1]:font-bold [&_a.rounded-full:first-of-type]:bg-accent [&_a.rounded-full:first-of-type:hover]:bg-primary"
                eyebrow={hero.eyebrow}
                eyebrowVisibleOn={textoVisibleOn(hero, "eyebrow")}
                title={hero.titulo}
                titleMobile={hero.tituloMobile}
                titleVisibleOn={textoVisibleOn(hero, "titulo")}
                lead={hero.bajada}
                leadMobile={hero.bajadaMobile}
                leadVisibleOn={textoVisibleOn(hero, "bajada")}
                imageSrc={imagenHero}
                imageAlt={hero.imagenAlt}
                renderImage={imagenNext}
                renderLink={linkNext}
                ctas={sinItemsOcultos(hero.ctas).map((c) => ({
                  label: c.label,
                  href: c.href,
                  visibleOn: aVisibleOn(c.visibilidad),
                }))}
                usps={hero.usps
                  .map((u, i) => {
                    // El ícono va por la posición original: ocultar uno no le
                    // cambia el ícono a los de al lado.
                    const Icon = ICONOS_USP[i % ICONOS_USP.length];
                    // El USP de WhatsApp lleva al mismo número que el CTA de abajo.
                    const href = /whatsapp/i.test(u.label) ? whatsapp.href : undefined;
                    return { label: u.label, icon: <Icon />, href, visibilidad: u.visibilidad };
                  })
                  .filter((u) => u.visibilidad !== "nunca")
                  .map(({ visibilidad, ...u }) => ({ ...u, visibleOn: aVisibleOn(visibilidad) }))}
              />
              </InteractiveHero>
            </SeccionEditable>
          </Reveal>
        </div>
      </div>

      <SeccionEditable seccion="marquee" visibilidad={vis("marquee")}>
        <PorTamano items={marquee.items}>
          {(items) => (
            <Marquee
              items={items.map((it) => (it.logo ? { src: it.logo, alt: it.texto } : it.texto))}
              renderImage={imagenNext}
              className="mt-[clamp(28px,4vw,48px)] [&_span]:font-semibold [&_span]:not-italic"
            />
          )}
        </PorTamano>
      </SeccionEditable>

      <div className="mx-auto max-w-contenido px-[clamp(18px,4vw,48px)]">
        {/* Ambientes */}
        <Reveal>
          <SeccionEditable seccion="ambientes" visibilidad={vis("ambientes")}>
            <section className="pt-[clamp(56px,7vw,96px)]">
              <TituloSeccion textos={ambientes} linkTodos={ambientes.linkTodos} />
              {/* Tiles a la altura del diseño aprobado (guía §4): el DS usa
                  min-h menores; la variante "mosaic" debería llevarla (DS gap). */}
              <PorTamano items={ambientes.items}>
                {(items) => <RoomTiles className="[&>a]:min-h-[300px]" items={aTilesDS(items)} renderImage={imagenNext} renderLink={linkNext} />}
              </PorTamano>
            </section>
          </SeccionEditable>
        </Reveal>

        {/* Destacados: productos reales del catálogo (precio y cuotas vivos). */}
        <Reveal>
          <SeccionEditable seccion="destacados" visibilidad={vis("destacados")}>
            <section className="pt-[clamp(56px,7vw,96px)]">
              <TituloSeccion textos={secDestacados} linkTodos={secDestacados.linkTodos} />
              {destacados}
            </section>
          </SeccionEditable>
        </Reveal>

        {/* Banner decorativo */}
        <Reveal>
          <SeccionEditable seccion="bannerDeco" visibilidad={vis("bannerDeco")}>
            <PromoBanner
              className="mt-[clamp(56px,7vw,96px)] [&_em]:not-italic [&_h2]:font-bold"
              eyebrow={bannerDeco.eyebrow}
              eyebrowVisibleOn={textoVisibleOn(bannerDeco, "eyebrow")}
              title={bannerDeco.titulo}
              titleMobile={bannerDeco.tituloMobile}
              titleVisibleOn={textoVisibleOn(bannerDeco, "titulo")}
              lead={bannerDeco.bajada}
              leadMobile={bannerDeco.bajadaMobile}
              leadVisibleOn={textoVisibleOn(bannerDeco, "bajada")}
              cta={
                bannerDeco.cta && bannerDeco.cta.visibilidad !== "nunca"
                  ? { label: bannerDeco.cta.label, href: bannerDeco.cta.href, visibleOn: aVisibleOn(bannerDeco.cta.visibilidad) }
                  : undefined
              }
              imageSrc={bannerDeco.imagen}
              renderLink={linkNext}
              renderImage={imagenNext}
            />
          </SeccionEditable>
        </Reveal>

        {/* Deco grid */}
        <Reveal>
          <SeccionEditable seccion="decoGrid" visibilidad={vis("decoGrid")}>
            <section className="pt-[clamp(56px,7vw,96px)]">
              <TituloSeccion textos={decoGrid} linkTodos={decoGrid.linkTodos} />
              {/* Mobile: apiladas, se despegan al scrollear. Desde lg, la grilla. */}
              <PorTamano items={decoGrid.items}>
                {(items) => (
                  <>
                    <RoomTiles variant="stack" items={aTilesDS(items)} className="lg:hidden" renderImage={imagenNext} renderLink={linkNext} />
                    <RoomTiles variant="grid" items={aTilesDS(items)} className="hidden lg:grid" renderImage={imagenNext} renderLink={linkNext} />
                  </>
                )}
              </PorTamano>
            </section>
          </SeccionEditable>
        </Reveal>

        {/* Servicios */}
        <Reveal>
          <SeccionEditable seccion="servicios" visibilidad={vis("servicios")}>
            <section className="grid grid-cols-1 gap-5 py-[clamp(56px,7vw,96px)] sm:grid-cols-2 lg:grid-cols-4">
              {servicios.items.map((s, i) => {
                if (s.visibilidad === "nunca") return null;
                const Icon = ICONOS_SERVICIO[i % ICONOS_SERVICIO.length];
                return (
                  <ServiceCard
                    key={`${i}-${s.titulo ?? ""}`}
                    // Solo dónde se ve la tarjeta (display), no su estilo.
                    className={clasesVisibilidad(s.visibilidad) || undefined}
                    icon={<Icon />}
                    title={s.titulo}
                    text={s.texto}
                  />
                );
              })}
            </section>
          </SeccionEditable>
        </Reveal>

        {/* WhatsApp CTA (conversión, se preserva del diseño anterior) */}
        <SeccionEditable seccion="whatsapp" visibilidad={vis("whatsapp")}>
          <div className="pb-[clamp(56px,7vw,96px)]">
            <CtaBanner
              icon={<ChatIcon />}
              title={whatsapp.titulo}
              titleVisibleOn={textoVisibleOn(whatsapp, "titulo")}
              text={whatsapp.texto}
              textVisibleOn={textoVisibleOn(whatsapp, "texto")}
              cta={{ label: "Consultar ahora", href: whatsapp.href }}
            />
          </div>
        </SeccionEditable>
      </div>
    </main>
  );
}
