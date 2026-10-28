import { hrefInstagram, type RedFooter } from "@/data/footer";

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

/**
 * Franja "Síganos en Instagram" arriba del footer, en todas las páginas: una
 * tarjeta por cuenta (una por local), que abre el perfil en otra pestaña. Las
 * cuentas salen de `redes` en la fila `footer` (editor del footer); sin
 * cuentas no se pinta nada. Server component: va en el shell estático junto
 * con el footer.
 */
export function FranjaRedes({ redes }: { redes: RedFooter[] }) {
  if (redes.length === 0) return null;
  return (
    <section aria-labelledby="franja-redes-titulo" className="mx-auto max-w-contenido px-[clamp(18px,4vw,48px)] pb-[clamp(40px,5vw,64px)]">
      <div className="flex flex-col gap-6 rounded-2xl border border-border bg-surface p-[clamp(20px,3vw,32px)] xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(45deg,#f9a825,#e1306c_55%,#833ab4)] text-white">
            <InstagramIcon className="size-6" />
          </span>
          <div>
            <h2 id="franja-redes-titulo" className="font-display text-[clamp(22px,2.4vw,28px)] font-bold leading-tight tracking-[-0.01em] text-text">
              Síganos en Instagram
            </h2>
            <p className="mt-1 text-[14px] leading-snug text-muted">Novedades, ofertas y lanzamientos de cada local.</p>
          </div>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 xl:shrink-0 xl:grid-cols-[repeat(2,minmax(0,300px))]">
          {redes.map((r) => (
            <li key={r.usuario}>
              <a
                href={hrefInstagram(r.usuario)}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-3 rounded-xl border border-border bg-bg px-4 py-3 transition-colors hover:border-accent"
              >
                <InstagramIcon className="size-5 shrink-0 text-text transition-colors group-hover:text-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-bold leading-snug text-text">{r.nombre}</span>
                  <span className="block truncate text-[13px] text-muted">@{r.usuario}</span>
                </span>
                <span className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-[12.5px] font-extrabold text-on-primary transition-colors group-hover:bg-primary-hover">
                  Seguir
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
