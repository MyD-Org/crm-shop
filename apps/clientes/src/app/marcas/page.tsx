import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { cn } from "@myd-org/ui";
import { ImagenMarca } from "@/components/marcas/ImagenMarca";
import { getMarca } from "@/lib/marca";
import { getPaginasMarcaPublicadas } from "@/lib/marcas/marcas-datos";
import { hrefMarca } from "@/lib/marcas/pagina-marca";

export async function generateMetadata(): Promise<Metadata> {
  const marca = await getMarca();
  return { title: { absolute: `Marcas | ${marca.nombre}` }, alternates: { canonical: "/marcas" } };
}

/**
 * Índice de las páginas de marca publicadas (spec 2026-10-20 §2). La tienda
 * oficial va primero, en tarjeta oscura con su bajada. Sin ninguna publicada:
 * 404 (una tienda que no armó marcas no tiene esta página).
 */
export default function MarcasPage() {
  return (
    <Suspense fallback={<div className="min-h-[50vh] flex-1" />}>
      <Contenido />
    </Suspense>
  );
}

async function Contenido() {
  const paginas = await getPaginasMarcaPublicadas();
  if (paginas.length === 0) notFound();
  return (
    <main className="mx-auto w-full max-w-contenido flex-1 px-[clamp(18px,4vw,48px)] py-10">
      <h1 className="mb-8 font-display text-[clamp(30px,4vw,48px)] font-medium tracking-tight text-text">Marcas</h1>
      <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {paginas.map((p) => {
          const oficial = p.nivel === "oficial";
          return (
            <li key={p.slug} className={cn(oficial && "col-span-2")}>
              <Link
                href={hrefMarca(p.slug)}
                data-tema-marca={oficial ? "oficial" : undefined}
                className={cn(
                  "flex h-full flex-col gap-4 rounded-xl border border-border p-5 transition-shadow hover:shadow-md",
                  oficial ? "sm:flex-row sm:items-center" : "items-center bg-surface text-center",
                )}
              >
                <span className="relative flex h-20 w-full max-w-40 shrink-0 items-center justify-center rounded-lg bg-white p-3">
                  {p.logo ? (
                    <ImagenMarca src={p.logo} alt={`Logo de ${p.nombre}`} sizes="160px" fit="logo" className="h-auto max-h-full w-full object-contain" />
                  ) : (
                    <span className="font-display text-lg font-semibold text-[#0c0c0c]">{p.nombre}</span>
                  )}
                </span>
                <span className="flex flex-col gap-1">
                  {oficial ? (
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">Tienda oficial</span>
                  ) : null}
                  <span className="font-display text-xl font-medium text-text">{p.nombre}</span>
                  {oficial && p.bajada ? <span className="text-sm text-muted">{p.bajada}</span> : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
