import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@myd-org/ui";
import { FavoritosCompartidosLista } from "@/components/favoritos/FavoritosCompartidosLista";
import { parsearIdsFavoritos } from "@/lib/favoritos-compartidos";
import { productosFavoritosCompartidos } from "@/lib/favoritos-compartidos-datos";

/**
 * Lista de favoritos compartida por link (ver src/lib/favoritos-compartidos.ts).
 *
 * Renderizarla NO modifica carrito ni favoritos: WhatsApp y compañía la abren
 * para armar la vista previa. Agregar es siempre un toque del usuario. No va a
 * `RUTAS_PUBLICAS` del proxy: la abre una persona, que pasa por el gate como en
 * cualquier otra página.
 */

type Props = { searchParams: Promise<{ i?: string | string[] }> };

const valor = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// Estática a propósito: con Cache Components, una metadata que lee
// `searchParams` bloquea el render de toda la página.
export const metadata: Metadata = {
  title: "Le compartieron una lista de favoritos",
  description: "Revise los productos y agréguelos a su carrito o a sus favoritos.",
  robots: { index: false, follow: false },
};

function SinProductos({ texto }: { texto: string }) {
  return (
    <main className="mx-auto flex w-full max-w-contenido flex-1 flex-col items-center justify-center gap-4 px-4 py-20 text-center">
      <p className="text-2xl font-bold text-text">{texto}</p>
      <Link href="/catalogo">
        <Button>Ver catálogo</Button>
      </Link>
    </main>
  );
}

// `searchParams` se lee acá, dentro del `loading.tsx` de la ruta (Suspense), no
// en la metadata ni en el layout.
export default async function FavoritosCompartidosPage({ searchParams }: Props) {
  const ids = parsearIdsFavoritos(valor((await searchParams).i));
  if (ids.length === 0) return <SinProductos texto="Este enlace no tiene productos" />;

  const { productos, noDisponibles } = await productosFavoritosCompartidos(ids);
  if (productos.length === 0) {
    return <SinProductos texto="Los productos de esta lista ya no están disponibles" />;
  }

  return (
    <main className="mx-auto w-full max-w-contenido flex-1 px-4 pb-16 pt-6 lg:pt-8">
      <h1 className="font-display text-[26px] font-semibold tracking-tight text-text lg:text-[32px]">
        Le compartieron una lista de favoritos
      </h1>
      <p className="mb-6 mt-1 text-sm text-muted">
        Revise los productos y agréguelos a su carrito o a sus favoritos. Los precios son los actuales de la tienda.
      </p>
      <FavoritosCompartidosLista productos={productos} noDisponibles={noDisponibles} />
    </main>
  );
}
