import type { DatosLegales } from "@/data/home-defaults";
import type { Bloque } from "@/lib/legales/comun";
import Link from "next/link";
import type { ReactNode } from "react";
import { BotonDatosLegales } from "./BotonDatosLegales";

/**
 * Página legal genérica (server): título + bloques armados en `src/lib/legales`.
 * El botón de edición solo se renderiza para admins (`puedeEditar`): para los
 * visitantes no hay ningún control en el HTML. `children` va debajo de los
 * bloques (el formulario de /arrepentimiento).
 */
export function PaginaLegal({
  titulo,
  bloques,
  datos,
  puedeEditar,
  children,
}: {
  titulo: string;
  bloques: Bloque[];
  datos: DatosLegales;
  puedeEditar: boolean;
  children?: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-medium tracking-tight text-text">{titulo}</h1>
        {puedeEditar ? <BotonDatosLegales inicial={datos} /> : null}
      </div>
      <div className="flex flex-col gap-8">
        {bloques.map((b) => (
          <section key={b.titulo} className="flex flex-col gap-3">
            <h2 className="font-display text-xl font-medium tracking-tight text-text">{b.titulo}</h2>
            {b.parrafos.map((p) => (
              <p key={p} className="text-base leading-relaxed text-muted">
                {p}
              </p>
            ))}
            {b.enlaces?.length ? (
              <ul className="flex flex-col gap-1">
                {b.enlaces.map((e) => (
                  <li key={e.href}>
                    {e.external ? (
                      <a href={e.href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                        {e.label}
                      </a>
                    ) : (
                      <Link href={e.href} className="text-primary underline underline-offset-2">
                        {e.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
        {children}
      </div>
    </main>
  );
}
