"use client";

import { useEffect } from "react";
import { Button, EmptyState } from "@myd-org/ui";
import { BotonEnlace } from "@/components/mi-cuenta/BotonEnlace";

/**
 * Error inesperado al renderizar una página. Va dentro del layout raíz (header
 * y footer quedan); los errores del propio layout los toma `global-error.tsx`.
 * En producción el mensaje de un error de servidor viene genérico: el
 * `digest` es lo que se cruza con los logs de Vercel.
 */
export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 items-center px-4 py-16">
      <EmptyState
        className="w-full"
        title="No pudimos cargar esta página"
        description={
          <>
            Ocurrió un error inesperado. Inténtelo de nuevo en unos instantes.
            {error.digest ? <span className="mt-2 block text-xs">Código: {error.digest}</span> : null}
          </>
        }
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <Button onClick={() => unstable_retry()}>Reintentar</Button>
            <BotonEnlace href="/" variant="secondary">Ir al inicio</BotonEnlace>
          </div>
        }
      />
    </main>
  );
}
