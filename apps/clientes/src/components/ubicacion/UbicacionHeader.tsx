import { Suspense } from "react";
import { connection } from "next/server";
import { TEXTOS_UBICACION, textoUbicacion } from "@/lib/ubicacion";
import { ubicacionDelVisitante } from "@/lib/ubicacion-servidor";
import { SelectorUbicacion } from "./SelectorUbicacion";

/**
 * "Estás en <localidad>, <provincia>" con el modal para cambiarla. El Header del DS no tiene un
 * lugar para esto (sólo `search` y `actions`), así que va como una franja propia debajo de él, sin
 * tocar el DS. Va en el shell estático con un hueco por request: mientras llega, la franja reserva
 * su alto (sin texto) para que la página no salte.
 */
const FRANJA = "border-b border-border bg-surface";
const CONTENEDOR = "mx-auto flex h-9 w-full max-w-contenido items-center gap-2 px-4 text-[13px]";

export function UbicacionHeader() {
  return (
    <Suspense fallback={<div aria-hidden className={FRANJA}><div className={CONTENEDOR} /></div>}>
      <UbicacionDinamica />
    </Suspense>
  );
}

async function UbicacionDinamica() {
  // Lee cookie e identidad: hueco por request.
  await connection();
  const { ubicacion, origen } = await ubicacionDelVisitante();
  return (
    <div className={FRANJA}>
      <div className={CONTENEDOR}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-accent">
          <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        {ubicacion ? (
          <>
            <span className="min-w-0 truncate text-text">{textoUbicacion(ubicacion)}</span>
            <SelectorUbicacion
              conUbicacion={origen === "cookie"}
              className="shrink-0 font-semibold text-accent underline-offset-2 hover:underline"
            >
              {TEXTOS_UBICACION.cambiar}
            </SelectorUbicacion>
          </>
        ) : (
          <SelectorUbicacion className="font-semibold text-accent underline-offset-2 hover:underline">
            {TEXTOS_UBICACION.pedir}
          </SelectorUbicacion>
        )}
      </div>
    </div>
  );
}
