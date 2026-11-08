import { useId } from "react";
import { COLORES, ESCENA } from "@/components/home/escena-piedra";
import { CapaLA, DefinicionesPiedra, JuntasPiedra } from "./escena-comun";
import estilos from "./piedra.module.css";

/** Recortes del lienzo de 3000 x 1600 (el SVG se recorta con `slice`, como el hero). */
export const RECORTES = {
  /** Todo el lienzo. */
  completo: `0 0 ${ESCENA.ancho} ${ESCENA.alto}`,
  /** Bloque de texto a la izquierda y LA a la derecha (404, carrito vacío, "Visítenos"). */
  bloque: "460 300 1700 800",
  /** Página entera detrás del formulario de ingreso, con el LA a la derecha de la tarjeta. */
  pagina: "356 100 1800 1200",
} as const;
export type Recorte = keyof typeof RECORTES;

/**
 * Piedra quieta, sólo dibujo: SVG estático (sin JS, sin cuadros de animación). Es decorativa
 * (`aria-hidden`); lo que se toca va aparte (`BloquePiedra`).
 *
 * - `conLA`: dibuja el letrero. Apagado hasta que el contenedor con la clase encendible reciba
 *   `data-encendido` (el CSS del hero lo prende con su parpadeo).
 */
export function PiedraDecorativa({
  recorte = "completo",
  alineacion = "xMidYMid",
  conLA = false,
  className,
}: {
  recorte?: Recorte;
  alineacion?: "xMidYMid" | "xMaxYMid";
  conLA?: boolean;
  className?: string;
}) {
  const uid = useId().replaceAll(":", "");
  const clase = className ? `${estilos.capa} ${className}` : estilos.capa;
  const vista = RECORTES[recorte];
  const preserve = `${alineacion} slice`;
  return (
    <>
      <svg aria-hidden="true" focusable="false" className={clase} viewBox={vista} preserveAspectRatio={preserve}>
        {conLA ? <DefinicionesPiedra uid={uid} /> : null}
        <rect x="-500" y="-500" width={ESCENA.ancho + 1000} height={ESCENA.alto + 1000} fill={COLORES.noche} />
        <JuntasPiedra uid={uid} conLA={conLA} />
        {conLA ? <CapaLA uid={uid} /> : null}
      </svg>
    </>
  );
}
