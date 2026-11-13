"use client";

import { useRef, type ReactNode } from "react";
import { EscenaPiedraViva } from "@/components/home/HeroPiedra";
import { CLASE_ENCENDIBLE } from "./escena-comun";
import { RECORTES } from "./PiedraDecorativa";
import estilos from "./piedra.module.css";

/**
 * Fondo de las páginas de ingreso y de alta (Clerk): la escena viva del hero detrás de la tarjeta.
 * La luz sigue al cursor (o al dedo) y va encendiendo las juntas; el LA, a la derecha, arranca
 * encendido (parpadea una vez al cargar; quieto con movimiento reducido). Apagado, no agrega ni un nodo: devuelve el contenido tal cual. El
 * encabezado de la página va en claro; la tarjeta de Clerk no se toca.
 */
export function FondoPiedra({ piedra, children }: { piedra: boolean; children: ReactNode }) {
  const raiz = useRef<HTMLDivElement>(null);
  if (!piedra) return <>{children}</>;
  return (
    <div ref={raiz} className={`${CLASE_ENCENDIBLE} ${estilos.pagina}`} data-fondo-piedra="" data-encendido="">
      <EscenaPiedraViva raiz={raiz} vista={RECORTES.pagina} alineacion="xMaxYMid" sinBorde />
      {children}
    </div>
  );
}
