import { Skeleton } from "@myd-org/ui";

/**
 * Silueta del carrito mientras el servidor resuelve la identidad y la oferta
 * de cuotas (`getOfertaCuotasSinCache`, sin caché: siempre en vivo). Misma
 * grilla que `CarritoClient` (ítems + resumen) para que no salte al llegar.
 */
export default function CargandoCarrito() {
  return (
    <main className="mx-auto w-full max-w-contenido flex-1 px-4 py-8" aria-busy>
      <Skeleton className="mb-6 h-9 w-40" />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Skeleton className="h-28 w-full rounded-[20px]" />
          <Skeleton className="h-28 w-full rounded-[20px]" />
          <Skeleton className="h-28 w-full rounded-[20px]" />
        </div>

        <div className="h-fit rounded-[24px] border border-border bg-surface p-6 lg:sticky lg:top-24">
          <Skeleton className="mb-4 h-5 w-24" />
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
