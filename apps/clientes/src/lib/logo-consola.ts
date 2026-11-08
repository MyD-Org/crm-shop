/**
 * Logo de la tienda en la consola del navegador (para quien abre las herramientas de desarrollo).
 * Chrome y Firefox dibujan un `background-image` en un `console.log` con `%c`; el texto va aparte,
 * así se lee igual en un navegador que no muestre la imagen.
 */
export function argumentosLogoConsola({
  logoUrl,
  nombre,
  ancho = 240,
  alto = 48,
}: {
  logoUrl: string | null;
  nombre: string;
  ancho?: number;
  alto?: number;
}): string[] {
  const texto = `%c${nombre}`;
  const estiloTexto = "font: 600 14px system-ui, sans-serif; color: #64748b;";
  if (!logoUrl) return [texto, estiloTexto];
  const imagen = [
    `background: url("${logoUrl.replace(/"/g, "%22")}") no-repeat left center / contain`,
    `padding: ${alto / 2}px ${ancho / 2}px`,
    "font-size: 0",
    "line-height: 0",
  ].join("; ");
  return [`%c %c\n${nombre}`, imagen, estiloTexto];
}
