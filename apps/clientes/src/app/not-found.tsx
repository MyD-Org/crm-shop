import type { Metadata } from "next";
import { EmptyState } from "@myd-org/ui";
import { BotonEnlace } from "@/components/mi-cuenta/BotonEnlace";
import { BloquePiedra } from "@/components/piedra/BloquePiedra";
import { getDecoracion } from "@/lib/home-datos";

export const metadata: Metadata = { title: "Página no encontrada" };

const TITULO = "No encontramos la página que busca";
const DESCRIPCION = "Es posible que el enlace esté mal escrito o que el producto ya no esté disponible.";

const acciones = (
  <>
    <BotonEnlace href="/catalogo">Ver el catálogo</BotonEnlace>
    <BotonEnlace href="/" variant="secondary">Ir al inicio</BotonEnlace>
  </>
);

/**
 * 404 de toda la tienda: rutas que no existen y los `notFound()` de las páginas
 * (producto inexistente, pedido ajeno…). Va dentro del layout raíz, así que
 * conserva header y footer. Con la textura de piedra prendida en el sitio, el mismo texto va
 * sobre un bloque de piedra con el LA apagado (se enciende al tocarlo).
 */
export default async function NotFound() {
  const { piedra } = await getDecoracion();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 items-center px-4 py-16">
      {piedra ? (
        <BloquePiedra titulo={TITULO} descripcion={DESCRIPCION}>{acciones}</BloquePiedra>
      ) : (
        <EmptyState
          className="w-full"
          title={TITULO}
          description={DESCRIPCION}
          action={<div className="flex flex-wrap justify-center gap-3">{acciones}</div>}
        />
      )}
    </main>
  );
}
