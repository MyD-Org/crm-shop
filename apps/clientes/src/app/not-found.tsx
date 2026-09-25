import type { Metadata } from "next";
import { EmptyState } from "@myd-org/ui";
import { BotonEnlace } from "@/components/mi-cuenta/BotonEnlace";

export const metadata: Metadata = { title: "Página no encontrada" };

/**
 * 404 de toda la tienda: rutas que no existen y los `notFound()` de las páginas
 * (producto inexistente, pedido ajeno…). Va dentro del layout raíz, así que
 * conserva header y footer.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 items-center px-4 py-16">
      <EmptyState
        className="w-full"
        title="No encontramos la página que busca"
        description="Es posible que el enlace esté mal escrito o que el producto ya no esté disponible."
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <BotonEnlace href="/catalogo">Ver el catálogo</BotonEnlace>
            <BotonEnlace href="/" variant="secondary">Ir al inicio</BotonEnlace>
          </div>
        }
      />
    </main>
  );
}
