"use client";

import { useEffect } from "react";
import { TEMA_POR_DEFECTO } from "@/lib/tema-ip";
import "./globals.css";

/**
 * Último recurso: falló el layout raíz (anuncio, header, Clerk…), así que esta
 * página reemplaza al layout entero y trae su propio <html>/<body>. Sin DS ni
 * providers a propósito: cuanto menos dependa de lo que acaba de romperse,
 * mejor. Los tokens del tema salen de globals.css con el data-theme por defecto.
 */
export default function GlobalError({
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
    <html lang="es" data-theme={TEMA_POR_DEFECTO} className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-bg text-text">
        <title>Error — Central LED</title>
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
          <h1 className="text-xl font-semibold">No pudimos cargar la tienda</h1>
          <p className="text-muted">Ocurrió un error inesperado. Inténtelo de nuevo en unos instantes.</p>
          {error.digest ? <p className="text-xs text-muted">Código: {error.digest}</p> : null}
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => unstable_retry()}
              className="rounded-lg bg-primary px-4 py-2 font-semibold text-on-primary"
            >
              Reintentar
            </button>
            {/* <a> y no <Link>: recarga completa, por si el error vive en el estado del cliente. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="rounded-lg border border-border px-4 py-2 font-semibold">
              Ir al inicio
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
