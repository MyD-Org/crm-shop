import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EditorMarcas } from "@/components/marcas/EditorMarcas";
import { esAdmin } from "@/lib/auth";
import { leerPaginasMarcaParaEditor } from "@/lib/marcas/marcas-acciones";

export const metadata: Metadata = { title: "Páginas de marca", robots: { index: false, follow: false } };

/**
 * Lista de páginas de marca (spec 2026-10-20-marcas-tienda-oficial §10). Solo
 * admins: cualquier otro visitante recibe 404. El contenido de cada página se
 * edita en la página misma (`/marcas/<slug>`, modo edición); acá se crean,
 * ordenan, publican y borran.
 */
export default function EditarMarcasPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <h1 className="mb-2 font-display text-3xl font-medium tracking-tight text-text">Páginas de marca</h1>
      <p className="mb-8 text-base leading-relaxed text-muted">
        Cada marca tiene su página en la tienda. Mientras esté oculta, solo usted puede verla. El contenido se edita
        desde la página, con el modo edición.
      </p>
      <Suspense fallback={null}>
        <Contenido />
      </Suspense>
    </main>
  );
}

async function Contenido() {
  if (!(await esAdmin())) notFound();
  const r = await leerPaginasMarcaParaEditor();
  if (!r.ok) return <p className="text-base text-muted">{r.error}</p>;
  return <EditorMarcas paginas={r.paginas} />;
}
