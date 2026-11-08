import type { ReactNode } from "react";
import { PIEDRA } from "@/components/home/escena-piedra";
import { RECORTES } from "./PiedraDecorativa";
import estilos from "./piedra.module.css";

/**
 * Bloque para las páginas vacías (404, carrito vacío) con la piedra prendida: el texto de siempre
 * centrado sobre el fondo de la página, con las juntas de la piedra en un tono suave del tema que
 * se apagan hacia el centro y los bordes. Sin el LA ni la piedra oscura: sólo dibujo estático.
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
  return (
    <div className={estilos.bloque} data-bloque-piedra="" role="status">
      <svg
        aria-hidden="true"
        focusable="false"
        className={`${estilos.capa} ${estilos.juntasClaras}`}
        viewBox={RECORTES.completo}
        preserveAspectRatio="xMidYMid slice"
      >
        <path d={PIEDRA.juntas} strokeWidth="6.6" fill="none" strokeLinejoin="bevel" />
      </svg>
      <div className={estilos.contenido}>
        <p className={estilos.titulo}>{titulo}</p>
        {descripcion ? <p className={estilos.descripcion}>{descripcion}</p> : null}
        {children ? <div className={estilos.acciones}>{children}</div> : null}
      </div>
    </div>
  );
}
