import { useId } from "react";
import { COLORES, ESCENA, PIEDRA } from "@/components/home/escena-piedra";
import { CapaLA, DefinicionesPiedra, JuntasPiedra, idsDe } from "./escena-comun";
import estilos from "./piedra.module.css";

/** Recortes del lienzo de 3000 x 1600 (el SVG se recorta con `slice`, como el hero). */
export const RECORTES = {
  /** Todo el lienzo: pie de página y banda "Visítenos". */
  completo: `0 0 ${ESCENA.ancho} ${ESCENA.alto}`,
  /** Bloque de texto a la izquierda y LA a la derecha (404, carrito vacío). */
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
 * - `fondo`: pinta la Noche detrás. Sin fondo sólo quedan las juntas (textura del pie).
 * - `brillo`: segunda capa con las juntas encendidas que respira despacio; es una capa propia que
 *   sólo cambia de opacidad, así la animación no vuelve a pintar el dibujo.
 */
export function PiedraDecorativa({
  recorte = "completo",
  alineacion = "xMidYMid",
  fondo = true,
  conLA = false,
  brillo = false,
  opacidadJuntas,
  className,
}: {
  recorte?: Recorte;
  alineacion?: "xMidYMid" | "xMaxYMid";
  fondo?: boolean;
  conLA?: boolean;
  brillo?: boolean;
  opacidadJuntas?: number;
  className?: string;
}) {
  const uid = useId().replaceAll(":", "");
  const { id, url } = idsDe(uid);
  const clase = className ? `${estilos.capa} ${className}` : estilos.capa;
  const vista = RECORTES[recorte];
  const preserve = `${alineacion} slice`;
  return (
    <>
      <svg aria-hidden="true" focusable="false" className={clase} viewBox={vista} preserveAspectRatio={preserve}>
        {conLA ? <DefinicionesPiedra uid={uid} /> : null}
        {fondo ? <rect x="-500" y="-500" width={ESCENA.ancho + 1000} height={ESCENA.alto + 1000} fill={COLORES.noche} /> : null}
        <JuntasPiedra uid={uid} conLA={conLA} opacidad={opacidadJuntas} />
        {conLA ? <CapaLA uid={uid} /> : null}
      </svg>
      {brillo ? (
        <svg aria-hidden="true" focusable="false" className={`${clase} ${estilos.brillo}`} viewBox={vista} preserveAspectRatio={preserve}>
          <defs>
            <filter id={id("suave")} x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="8" /></filter>
          </defs>
          <path d={PIEDRA.juntas} stroke={COLORES.sodio} strokeWidth="16" fill="none" strokeLinejoin="bevel" filter={url("suave")} />
          <path d={PIEDRA.juntas} stroke={COLORES.filamento} strokeWidth="5" fill="none" strokeLinejoin="bevel" opacity=".8" />
        </svg>
      ) : null}
    </>
  );
}
