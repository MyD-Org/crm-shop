import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EditorPaginas } from "@/components/paginas/EditorPaginas";
import { esAdmin } from "@/lib/auth";
import { leerPaginasParaEditor } from "@/lib/paginas-acciones";

export const metadata: Metadata = { title: "Editar páginas", robots: { index: false, follow: false } };

/**
 * Editor de las páginas institucionales. Solo admins: cualquier otro visitante
 * recibe 404 (la ruta no se delata). Dinámica (depende de la sesión), dentro de
 * Suspense por Cache Components; no está en el sitemap.
 */
export default function EditarPaginasPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <h1 className="mb-2 font-display text-3xl font-medium tracking-tight text-text">Páginas de la tienda</h1>
      <p className="mb-8 text-base leading-relaxed text-muted">
        Cada página se publica cuando usted lo indica. Mientras esté oculta, no se puede visitar ni aparece en el pie de página.
      </p>
      <Suspense fallback={null}>
        <Contenido />
      </Suspense>
    </main>
  );
}

async function Contenido() {
  if (!(await esAdmin())) notFound();
  const r = await leerPaginasParaEditor();
  if (!r.ok) return <p className="text-base text-muted">{r.error}</p>;
  return <EditorPaginas paginas={r.paginas} />;
}
