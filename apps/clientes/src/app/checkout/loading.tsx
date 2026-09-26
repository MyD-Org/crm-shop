import { Skeleton } from "@myd-org/ui";

/**
 * Silueta del checkout mientras el servidor resuelve identidad, datos de
 * facturación (puede ir a Alegra), la oferta de cuotas (sin caché, siempre en
 * vivo) y las direcciones guardadas. Misma grilla que `CheckoutClient`
 * (formulario + resumen sticky) para que el contenido no salte al llegar.
 */
export default function CargandoCheckout() {
  return (
    <main className="mx-auto w-full max-w-contenido flex-1 px-4 py-8" aria-busy>
      <Skeleton className="mb-6 h-4 w-40" />
      <Skeleton className="mb-6 h-9 w-72" />

      <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Skeleton className="h-8 w-full max-w-md rounded-full" />

          <div className="space-y-4 rounded-[20px] border border-border/50 bg-surface p-5">
            <Skeleton className="h-6 w-48" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
            <Skeleton className="h-16 w-full" />
          </div>
        </div>

        <div className="h-fit rounded-[24px] border border-border bg-surface p-6 lg:sticky lg:top-24">
          <Skeleton className="mb-4 h-5 w-24" />
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-24" />
          </div>
        </div>
      </div>

      <p className="sr-only" role="status">
        Cargando el checkout…
      </p>
    </main>
  );
}
