"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { enlazarEncendido } from "@/components/home/escena-piedra-controlador";
import { PiedraDecorativa, RECORTES } from "./PiedraDecorativa";
import { CLASE_ENCENDIBLE, POLIGONO_LA } from "./escena-comun";
import estilos from "./piedra.module.css";

/**
 * Bloque de piedra con el LA apagado para las páginas vacías (404, carrito vacío): el texto de
 * siempre sobre la piedra y, a la derecha, el LA. Tocarlo (o Enter / Espacio) lo enciende con el
 * parpadeo del hero. Sólo eventos: no hay cuadros de animación. Con movimiento reducido el CSS del
 * hero ya lo deja encendido y quieto.
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
  const la = useRef<SVGPathElement>(null);

  useEffect(() => {
    if (!raiz.current || !la.current) return;
    return enlazarEncendido({ hero: raiz.current, la: la.current }).soltar;
  }, []);

  return (
    <div ref={raiz} className={`${CLASE_ENCENDIBLE} ${estilos.bloque}`} data-bloque-piedra="" role="status">
      <PiedraDecorativa recorte="bloque" alineacion="xMaxYMid" conLA />
      <svg className={estilos.toque} viewBox={RECORTES.bloque} preserveAspectRatio="xMaxYMid slice">
        <path ref={la} className={estilos.laToque} d={POLIGONO_LA} tabIndex={0} role="button" aria-label="Encender el LA" />
      </svg>
      <div className={estilos.contenido}>
        <p className={estilos.titulo}>{titulo}</p>
        {descripcion ? <p className={estilos.descripcion}>{descripcion}</p> : null}
        {children ? <div className={estilos.acciones}>{children}</div> : null}
      </div>
    </div>
  );
}
