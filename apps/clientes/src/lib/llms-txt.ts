/**
 * /llms.txt: resumen del sitio en Markdown para agentes de IA (https://llmstxt.org).
 * Formato mínimo: un H1 con el nombre, una cita con la descripción y listas de enlaces.
 */

export interface DatosLlmsTxt {
  nombre: string;
  descripcion: string;
  /** Origen del sitio, sin barra final (https://cliente.example). */
  base: string;
  /** Páginas institucionales publicadas (Quiénes somos, Preguntas frecuentes...). */
  paginas: { label: string; href: string }[];
}

const una = (s: string) => s.replace(/\s+/g, " ").trim();

export function llmsTxt({
  nombre,
  descripcion,
  base,
  paginas,
}: DatosLlmsTxt): string {
  const enlace = (label: string, ruta: string, nota?: string) =>
    `- [${una(label)}](${base}${ruta})${nota ? `: ${nota}` : ""}`;

  const lineas = [
    `# ${una(nombre)}`,
    "",
    `> ${una(descripcion)}`,
    "",
    "Tienda online con precios en pesos argentinos (ARS), stock actualizado y compra con envío o retiro en el local.",
    "",
    "## Tienda",
    "",
    enlace("Inicio", "/"),
    enlace(
      "Catálogo",
      "/catalogo",
      "todos los productos, con filtros por categoría y marca",
    ),
    enlace(
      "Envíos y pagos",
      "/envios-y-pagos",
      "medios de pago, cuotas y formas de entrega",
    ),
    "",
    "## Datos para máquinas",
    "",
    enlace("Sitemap", "/sitemap.xml", "una URL por producto publicado"),
    enlace(
      "Feed de productos",
      "/feed/google.xml",
      "catálogo en RSS con precio, stock e imágenes",
    ),
  ];

  if (paginas.length) {
    lineas.push(
      "",
      "## Información",
      "",
      ...paginas.map((p) => enlace(p.label, p.href)),
    );
  }

  lineas.push(
    "",
    "## Optional",
    "",
    enlace("Términos y condiciones", "/terminos"),
    enlace("Política de privacidad", "/privacidad"),
    enlace("Botón de arrepentimiento", "/arrepentimiento"),
    "",
  );
  return lineas.join("\n");
}
