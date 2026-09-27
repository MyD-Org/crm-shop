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
    <main className="mx-auto w-full max-w-contenido flex-1 px-4 pb-16 pt-6 lg:pt-8" aria-busy>
      <Skeleton className="mb-5 h-4 w-56 lg:mb-6" />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-x-12">
        <Skeleton className="aspect-[4/3] w-full rounded-[24px] lg:aspect-square" />

        <div className="space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-10 w-4/5" />
            <Skeleton className="h-5 w-32" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-8 w-44 rounded-full" />
          <Skeleton className="hidden h-12 w-full rounded-full lg:block" />
        </div>
      </div>

      <p className="sr-only" role="status">
        Cargando producto…
      </p>
    </main>
  );
}
