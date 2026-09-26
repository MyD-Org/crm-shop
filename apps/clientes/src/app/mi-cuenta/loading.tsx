import { Skeleton } from "@myd-org/ui";

/**
 * Silueta del CONTENIDO de Mi cuenta (resumen, pedidos, facturas, etc.). El
 * nav y el saludo son del layout (`MiCuentaShell`), que no está en este
 * `Suspense`: ya se ven mientras esto carga. Genérica para cualquier sección
 * (tarjetas + lista), no una por página.
 */
export default function CargandoMiCuenta() {
  return (
    <div className="flex flex-col gap-8" aria-busy>
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>

      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>

      <p className="sr-only" role="status">
        Cargando…
      </p>
    </div>
  );
}
