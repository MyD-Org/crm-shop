import { Skeleton } from "@myd-org/ui";

/**
 * Silueta del carrito mientras el servidor resuelve la identidad y la oferta
 * de cuotas (`getOfertaCuotasSinCache`, sin caché: siempre en vivo). Misma
 * grilla que `CarritoClient` (ítems + resumen) para que no salte al llegar.
 */
export default function CargandoCarrito() {
  return (
    <main className="mx-auto w-full max-w-contenido flex-1 px-4 pb-16 pt-6 lg:pt-8" aria-busy>
      <Skeleton className="mb-5 h-8 w-48 lg:mb-6" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-9">
        <div className="space-y-4 rounded-[20px] border border-border bg-surface p-4 lg:p-6">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>

        <div className="h-fit rounded-[20px] border border-border bg-surface p-5 lg:sticky lg:top-24 lg:p-6">
          <Skeleton className="mb-4 h-5 w-40" />
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
          <Skeleton className="mt-4 h-11 w-full rounded-full" />
        </div>
      </div>

      <p className="sr-only" role="status">
        Cargando su carrito…
      </p>
    </main>
  );
}
