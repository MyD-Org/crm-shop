import Link from "next/link";
import { AccentText } from "@myd-org/ui";
import { clasesVisibilidad, type TextosSeccion } from "@/data/home-defaults";

/** Título, bajada y "Ver todos" de una sección de la home. */
export function TituloSeccion({ textos, linkTodos }: { textos: TextosSeccion; linkTodos?: string }) {
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
