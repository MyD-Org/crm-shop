import { PiedraDecorativa } from "./PiedraDecorativa";
import estilos from "./piedra.module.css";

/** Opacidad de las juntas sobre el fondo del pie: muy tenue, el texto sigue leyéndose igual. */
export const OPACIDAD_PIE = 0.25;

/**
 * Juntas de la piedra, muy tenues, sobre el pie de página. Es una capa decorativa por encima del
 * pie (sin eventos, sin JS) dentro de su contenedor `relative`. Apagado, no dibuja nada.
 */
export function TexturaPie({ piedra }: { piedra: boolean }) {
  if (!piedra) return null;
  return <PiedraDecorativa fondo={false} opacidadJuntas={OPACIDAD_PIE} className={estilos.pie} />;
}

/** Clases del contenedor del pie: con la piedra apagada, las de siempre. */
export function claseDelPie(piedra: boolean): string {
  return piedra ? "footer-global relative isolate" : "footer-global";
}
