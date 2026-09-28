import { Skeleton } from "@myd-org/ui";

/** Silueta de la preview mientras se resuelven los productos del link. */
export default function CargandoCarritoCompartido() {
  return (
    <main className="mx-auto w-full max-w-contenido flex-1 px-4 pb-16 pt-6 lg:pt-8" aria-busy>
      <Skeleton className="mb-2 h-8 w-72" />
      <Skeleton className="mb-6 h-4 w-96 max-w-full" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-9">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full rounded-[22px]" />
          <Skeleton className="h-24 w-full rounded-[22px]" />
        </div>
        <Skeleton className="h-40 w-full rounded-[20px]" />
      </div>
      <p className="sr-only" role="status">
        Cargando el carrito compartido…
      </p>
    </main>
  );
}
