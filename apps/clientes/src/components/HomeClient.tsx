import Link from "next/link";
import {
  Badge,
  ChipRow,
  Hero,
  Marquee,
  ProductCard,
  PromoBanner,
  RoomTiles,
  ServiceCard,
} from "@myd-org/ui";
import { AddToCartButton } from "@/components/AddToCartButton";
import { CuotasCard } from "@/components/CuotasCard";
import { Reveal } from "@/components/Reveal";
import { mejorOpcionPara } from "@/lib/cuotas-exhibicion";
import type { OfertaCuotas } from "@/lib/pagos/cuotas-tipos";
import type { Product } from "@/data/products";
import type { HomeContent, TileContent } from "@/data/home-defaults";

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
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function LightbulbIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
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
  }));
}

function TituloSeccion({
  titulo,
  acento,
  bajada,
  linkTodos,
}: {
  titulo: string;
  acento?: string;
  bajada?: string;
  linkTodos?: string;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-6 max-md:flex-col max-md:items-start">
      <div>
        <h2 className="font-display text-[clamp(30px,3.4vw,46px)] font-medium leading-[1.08] tracking-tight text-text">
          {titulo}
          {acento ? <em className="italic text-accent"> {acento}</em> : null}
        </h2>
        {bajada ? (
          <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-muted">{bajada}</p>
        ) : null}
      </div>
      {linkTodos ? (
        <a
          href={linkTodos}
          className="border-b-[1.5px] border-text pb-[3px] text-[13px] font-extrabold text-text transition-colors hover:border-accent hover:text-accent"
        >
          Ver todos →
        </a>
      ) : null}
    </div>
  );
}

/**
 * Home editorial. Server component: recibe oferta, contenido (DB mergeada con
 * defaults) y destacados desde el Server Component app/page.tsx.
 */
export function HomeClient({
  oferta,
  contenido,
  destacados,
}: {
  oferta: OfertaCuotas | null;
  contenido: HomeContent;
  destacados: Product[];
}) {
  const { anuncio, hero, marquee, ambientes, destacados: secDestacados, bannerDeco, decoGrid, servicios } = contenido;

  return (
    <>
      {/* Anuncio (contenido administrable) */}
      <div className="bg-primary px-4 py-2.5 text-center text-[12.5px] font-semibold tracking-wide text-on-primary">
        {anuncio.texto}
      </div>

      <main className="flex-1">
        <div className="mx-auto max-w-[1280px] px-[clamp(18px,4vw,48px)]">
          <div className="pt-[clamp(20px,3vw,36px)]">
            <Reveal>
              <Hero
                eyebrow={hero.eyebrow}
                title={hero.titulo}
                accent={hero.acento}
                lead={hero.bajada}
                imageSrc={hero.imagen}
                imageAlt={hero.imagenAlt}
                ctas={hero.ctas}
                usps={hero.usps.map((u, i) => {
                  const Icon = ICONOS_USP[i % ICONOS_USP.length];
                  return { label: u.label, icon: <Icon /> };
                })}
              />
            </Reveal>
          </div>
        </div>

        <Marquee items={marquee.items} className="mt-[clamp(28px,4vw,48px)]" />

        <div className="mx-auto max-w-[1280px] px-[clamp(18px,4vw,48px)]">
          {/* Ambientes */}
          <Reveal>
            <section className="pt-[clamp(56px,7vw,96px)]">
              <TituloSeccion titulo={ambientes.titulo} acento={ambientes.acento} bajada={ambientes.bajada} linkTodos={ambientes.linkTodos} />
              <RoomTiles items={aTilesDS(ambientes.items)} />
            </section>
          </Reveal>

          {/* Destacados */}
          <Reveal>
            <section className="pt-[clamp(56px,7vw,96px)]">
              <TituloSeccion titulo={secDestacados.titulo} acento={secDestacados.acento} bajada={secDestacados.bajada} linkTodos={secDestacados.linkTodos} />
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {destacados.map((p) => (
                  <Link key={p.id} href={`/producto/${p.id}`}>
                    <ProductCard
                      variant="editorial"
                      name={p.name}
                      brand={p.brand}
                      price={p.precioFinal ?? p.price}
                      oldPrice={p.oldPrice}
                      badge={p.badgeText ? <Badge tone={p.badgeTone}>{p.badgeText}</Badge> : undefined}
                      image={<LightbulbIcon className="h-20 w-20 text-muted/30" />}
                      action={
                        <AddToCartButton
                          product={{ id: p.id, name: p.name, brand: p.brand, price: p.price }}
                        />
                      }
                      installments={<CuotasCard opcion={mejorOpcionPara(p.precioFinal, oferta)} />}
                    />
                  </Link>
                ))}
              </div>
            </section>
          </Reveal>

          {/* Banner decorativo */}
          <Reveal>
            <PromoBanner
              className="mt-[clamp(56px,7vw,96px)]"
              eyebrow={bannerDeco.eyebrow}
              title={bannerDeco.titulo}
              accent={bannerDeco.acento}
              lead={bannerDeco.bajada}
              cta={bannerDeco.cta}
              imageSrc={bannerDeco.imagen}
            />
          </Reveal>

          {/* Deco grid + chips */}
          <Reveal>
            <section className="pt-[clamp(56px,7vw,96px)]">
              <TituloSeccion titulo={decoGrid.titulo} acento={decoGrid.acento} linkTodos={decoGrid.linkTodos} />
              <RoomTiles variant="grid" items={aTilesDS(decoGrid.items)} />
              <ChipRow chips={decoGrid.chips} className="mt-6" />
            </section>
          </Reveal>

          {/* Servicios */}
          <Reveal>
            <section className="grid grid-cols-1 gap-5 py-[clamp(56px,7vw,96px)] sm:grid-cols-2 lg:grid-cols-4">
              {servicios.items.map((s, i) => {
                const Icon = ICONOS_SERVICIO[i % ICONOS_SERVICIO.length];
                return <ServiceCard key={s.titulo} icon={<Icon />} title={s.titulo} text={s.texto} />;
              })}
            </section>
          </Reveal>

          {/* WhatsApp CTA (conversión, se preserva del diseño anterior) */}
          <section className="pb-[clamp(56px,7vw,96px)]">
            <div className="flex flex-wrap items-center justify-between gap-6 overflow-hidden rounded-[28px] bg-primary px-[clamp(24px,5vw,72px)] py-10 text-on-primary">
              <div className="flex items-center gap-5">
                <span className="[&_svg]:h-8 [&_svg]:w-8 [&_svg]:text-highlight">
                  <ChatIcon />
                </span>
                <div>
                  <p className="text-lg font-extrabold">¿Necesitás asesoramiento técnico?</p>
                  <p className="text-sm text-on-primary/70">
                    Escribinos por WhatsApp y te ayudamos a elegir el producto correcto.
                  </p>
                </div>
              </div>
              <a
                href="https://wa.me/5492235903025"
                className="shrink-0 rounded-full border-2 border-on-primary/60 px-6 py-2.5 text-sm font-bold transition-colors hover:bg-on-primary hover:text-primary"
              >
                Consultar ahora
              </a>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
