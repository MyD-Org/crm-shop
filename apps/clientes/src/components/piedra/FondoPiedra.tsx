import type { ReactNode } from "react";
import { PiedraDecorativa } from "./PiedraDecorativa";
import { CLASE_ENCENDIBLE } from "./escena-comun";
import estilos from "./piedra.module.css";

/**
 * Fondo de las páginas de ingreso y de alta (Clerk): la piedra oscura detrás de la tarjeta, con el
 * LA encendido (parpadea una vez al cargar, con CSS; quieto con movimiento reducido). Apagado, no
 * agrega ni un nodo: devuelve el contenido tal cual. El encabezado de la página va en claro; la
 * tarjeta de Clerk no se toca.
 */
export function FondoPiedra({ piedra, children }: { piedra: boolean; children: ReactNode }) {
  if (!piedra) return <>{children}</>;
  return (
    <div className={`${CLASE_ENCENDIBLE} ${estilos.pagina}`} data-fondo-piedra="" data-encendido="">
      <PiedraDecorativa recorte="pagina" alineacion="xMaxYMid" conLA />
      {children}
    </div>
  );
}
