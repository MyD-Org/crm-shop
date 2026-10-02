"use client";

import { type ReactNode, useRef, useState } from "react";
import dynamic from "next/dynamic";

/**
 * Disparador del modal "Seleccione dónde recibir su compra" (`ModalEnviarA`). Lo usan el header
 * ("Enviar a") y la ficha / el carrito ("Ingrese su localidad"): cada uno monta el suyo.
 *
 * El modal (radios, formularios, Georef) se descarga recién al primer click con `next/dynamic`
 * sin SSR: el header queda con el JS mínimo de este botón (prioridad de performance en mobile).
 * Cada apertura monta un modal nuevo (key), así el estado arranca limpio.
 */
const ModalEnviarA = dynamic(() => import("./ModalEnviarA"), { ssr: false });

export function SelectorUbicacion({
  children,
  className = "",
  conUbicacion = false,
  vigente,
}: {
  /** Contenido del botón que abre el modal. */
  children: ReactNode;
  className?: string;
  /** Con una elección guardada en la cookie se ofrece además quitarla. */
  conUbicacion?: boolean;
  /** Opción del modal que corresponde a la elección vigente (se muestra marcada). */
  vigente?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [apertura, setApertura] = useState(0);
  const botonRef = useRef<HTMLButtonElement>(null);

  function cambiarAbierto(abrir: boolean) {
    setAbierto(abrir);
    if (!abrir) requestAnimationFrame(() => botonRef.current?.focus());
  }

  return (
    <>
      <button
        ref={botonRef}
        type="button"
        onClick={() => {
          setApertura((n) => n + 1);
          setAbierto(true);
        }}
        aria-haspopup="dialog"
        className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] ${className}`}
      >
        {children}
      </button>
      {apertura > 0 && (
        <ModalEnviarA
          key={apertura}
          abierto={abierto}
          onOpenChange={cambiarAbierto}
          vigente={vigente}
          conUbicacion={conUbicacion}
        />
      )}
    </>
  );
}
