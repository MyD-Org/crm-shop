import { Skeleton } from "@myd-org/ui";

/**
 * Silueta de la ficha mientras el servidor la arma. La página es dinámica
 * (stock y overlay en cada request): sin esto, al tocar un producto no pasaba
 * nada visible hasta que llegaba la respuesta, y en el celular parecía que el
 * toque no había andado. Misma grilla y medidas que `ProductoClient` para que
 * el contenido no salte al llegar.
 */
export default function CargandoProducto() {
  return (
    <main className="mx-auto w-full max-w-contenido flex-1 px-4 py-8" aria-busy>
      <Skeleton className="mb-6 h-4 w-56" />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <Skeleton className="aspect-square w-full rounded-[24px]" />

        <div className="space-y-5">
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-4/5" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-40 w-full rounded-[24px]" />
          <Skeleton className="h-12 w-full rounded-full" />
        </div>
      </div>

      <p className="sr-only" role="status">
        Cargando producto…
      </p>
    </main>
  );
}
