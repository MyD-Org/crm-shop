import { Skeleton } from "@myd-org/ui";

/** Silueta de la lista mientras se resuelven los productos del link. */
export default function CargandoFavoritosCompartidos() {
  return (
    <main className="mx-auto w-full max-w-contenido flex-1 px-4 pb-16 pt-6 lg:pt-8" aria-busy>
      <Skeleton className="mb-2 h-8 w-80 max-w-full" />
      <Skeleton className="mb-6 h-4 w-96 max-w-full" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-32 w-full rounded-[22px]" />
        <Skeleton className="h-32 w-full rounded-[22px]" />
        <Skeleton className="h-32 w-full rounded-[22px]" />
      </div>
      <p className="sr-only" role="status">
        Cargando la lista compartida…
      </p>
    </main>
  );
}
