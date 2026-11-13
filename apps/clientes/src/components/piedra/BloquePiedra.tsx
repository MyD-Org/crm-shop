"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { entornoDelNavegador } from "@/components/home/HeroPiedra";
import { iniciarEscena } from "@/components/home/escena-piedra-controlador";
import { LUZ_INICIAL, PIEDRA, RADIO_LINTERNA } from "@/components/home/escena-piedra";
import { RECORTES } from "./PiedraDecorativa";
import estilos from "./piedra.module.css";

/**
 * Bloque para las páginas vacías (404, carrito vacío) con la piedra prendida: el texto de siempre
 * centrado sobre el fondo de la página, con las juntas de la piedra en un tono suave del tema que
 * se apagan hacia el centro y los bordes. Es la escena del hero en tono claro: la luz sigue al
 * cursor (en el celular deambula sola) y prende las juntas con el sodio. Sin el LA.
 */
export function BloquePiedra({
  titulo,
  descripcion,
  children,
}: {
  titulo: string;
  descripcion?: string;
  /** Las acciones (botones o enlaces) de la página. */
  children?: ReactNode;
}) {
  const raiz = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const luz = useRef<SVGCircleElement>(null);
  const uid = useId().replaceAll(":", "");
  const mascara = `${uid}-linterna`;
  const cono = `${uid}-cono`;

  useEffect(() => {
    const bloque = raiz.current, lienzo = svg.current, circulo = luz.current;
    if (!bloque || !lienzo || !circulo) return;
    // Sin LA: nada que tocar para encenderlo (ni encendido solo en el celular).
    return iniciarEscena({ ...entornoDelNavegador(bloque, lienzo), tactil: false, la: new EventTarget(), luz: circulo, ambiente: circulo });
  }, []);

  return (
    <div ref={raiz} className={estilos.bloque} data-bloque-piedra="" role="status">
      <svg
        ref={svg}
        aria-hidden="true"
        focusable="false"
        className={`${estilos.capa} ${estilos.juntasClaras}`}
        viewBox={RECORTES.completo}
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <radialGradient id={cono}>
            <stop offset="0" stopColor="#fff" /><stop offset=".5" stopColor="#fff" stopOpacity=".85" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <mask id={mascara} maskUnits="userSpaceOnUse" x="0" y="0" width="3000" height="1600">
            <circle ref={luz} cx={LUZ_INICIAL.x} cy={LUZ_INICIAL.y} r={RADIO_LINTERNA * 1.3} fill={`url(#${cono})`} />
          </mask>
        </defs>
        <path d={PIEDRA.juntas} strokeWidth="6.6" fill="none" strokeLinejoin="bevel" />
        <path className={estilos.resplandor} d={PIEDRA.juntas} strokeWidth="24" fill="none" strokeLinejoin="bevel" mask={`url(#${mascara})`} />
        <path className={estilos.juntasEncendidas} d={PIEDRA.juntas} strokeWidth="6.6" fill="none" strokeLinejoin="bevel" mask={`url(#${mascara})`} />
      </svg>
      <div className={estilos.contenido}>
        <p className={estilos.titulo}>{titulo}</p>
        {descripcion ? <p className={estilos.descripcion}>{descripcion}</p> : null}
        {children ? <div className={estilos.acciones}>{children}</div> : null}
      </div>
    </div>
  );
}
