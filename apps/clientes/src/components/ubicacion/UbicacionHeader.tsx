import { Suspense } from "react";
import { connection } from "next/server";
import { TEXTOS_UBICACION } from "@/lib/ubicacion";
import { ubicacionDelVisitante } from "@/lib/ubicacion-servidor";
import { SelectorUbicacion } from "./SelectorUbicacion";

/**
 * Indicador de ubicación bajo el logo del encabezado: pin + localidad + chevron; al tocarlo abre el
 * modal para cambiarla. Se pasa al Header del DS por su slot `brandExtra`. Va en el shell estático
 * con un hueco por request: mientras llega, reserva su alto (sin texto) para que no salte.
 */
const BOTON = "inline-flex max-w-full items-center gap-1 text-xs text-muted transition-colors hover:text-text";
const ALTO = "h-4";

export function UbicacionHeader() {
  return (
    <Suspense fallback={<div aria-hidden className={ALTO} />}>
      <UbicacionDinamica />
    </Suspense>
  );
}

async function UbicacionDinamica() {
  // Lee cookie e identidad: hueco por request.
  await connection();
  const { ubicacion, origen } = await ubicacionDelVisitante();
  return (
    <SelectorUbicacion conUbicacion={origen === "cookie"} className={BOTON}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
        <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
      <span className="min-w-0 truncate">{ubicacion ? ubicacion.localidad : TEXTOS_UBICACION.pedir}</span>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </SelectorUbicacion>
  );
}
