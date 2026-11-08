/**
 * Logo de la tienda en la consola del navegador (para quien abre las herramientas de desarrollo).
 * Chrome y Firefox dibujan un `background-image` en un `console.log` con `%c`. Con logo, sólo la
 * imagen (el logo ya dice el nombre); sin logo, el nombre en texto.
 */
export function argumentosLogoConsola({
  logoUrl,
  nombre,
  proporcion = 5,
  ancho = 240,
  margen = 10,
}: {
  logoUrl: string | null;
  nombre: string;
  /** Ancho / alto del logo, para que el recuadro no lo corte. */
  proporcion?: number;
  ancho?: number;
  margen?: number;
}): string[] {
  if (!logoUrl) return [`%c${nombre}`, "font: 600 14px system-ui, sans-serif; color: #64748b;"];
  const alto = Math.round(ancho / (proporcion > 0 ? proporcion : 5));
  const imagen = [
    // Fondo claro: el logo es oscuro y la consola suele estar en modo oscuro. El borde blanco es el
    // margen; `contain` dentro del padding no lo corta.
    `background: #fff url("${logoUrl.replace(/"/g, "%22")}") no-repeat center / contain`,
    `border: ${margen}px solid #fff`,
    "border-radius: 6px",
    `padding: ${alto / 2}px ${ancho / 2}px`,
    "font-size: 0",
    "line-height: 0",
  ].join("; ");
  return ["%c ", imagen];
}
