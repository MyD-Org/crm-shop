import type { Product } from "@/data/products";

/**
 * Feed de productos para Google Merchant Center (RSS 2.0 con el namespace `g:`).
 * Merchant Center lo lee de `/feed/google.xml` una vez por día. Función PURA.
 *
 * - Precio: el final con impuestos (`precioFinal ?? price`), el mismo que el JSON-LD de la ficha.
 * - Quedan afuera los productos sin precio o sin foto: Google exige los dos y los rechaza.
 * - Sin descripción se usa el nombre (Google también la exige).
 * - Sin marca ni código no hay identificadores: `identifier_exists` = no.
 */

const escapar = (texto: string) =>
  texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const plano = (texto: string | undefined) => texto?.replace(/\s+/g, " ").trim() || undefined;

/** Google acepta hasta 5000 caracteres de descripción y 150 de título. */
const recortar = (texto: string, max: number) => (texto.length > max ? `${texto.slice(0, max - 1).trimEnd()}…` : texto);

function item(p: Product, sitio: string): string | null {
  const fotos = p.images?.map((i) => i.url).filter(Boolean) ?? [];
  if (p.price <= 0 || fotos.length === 0) return null;
  const titulo = recortar(plano(p.name) ?? p.id, 150);
  const campos: [string, string][] = [
    ["id", p.id],
    ["title", titulo],
    ["description", recortar(plano(p.description) ?? titulo, 5000)],
    ["link", `${sitio}/producto/${encodeURIComponent(p.grupo?.representanteId ?? p.id)}`],
    ["image_link", fotos[0]],
    ...fotos.slice(1, 11).map((url): [string, string] => ["additional_image_link", url]),
    ["price", `${(p.precioFinal ?? p.price).toFixed(2)} ARS`],
    ["availability", p.stock === "out" ? "out_of_stock" : "in_stock"],
    ["condition", "new"],
  ];
  const marca = plano(p.brand);
  // El código de Alegra es "<código del fabricante>-<sufijo de la marca>" (101050-GEN): Google
  // quiere el del fabricante como MPN. La tienda sigue mostrando el código completo.
  const codigo = plano(p.sku)?.replace(/-[^-]+$/, "") || undefined;
  if (marca) campos.push(["brand", marca]);
  if (codigo) campos.push(["mpn", codigo]);
  if (!marca || !codigo) campos.push(["identifier_exists", "no"]);
  if (p.category) campos.push(["product_type", plano(p.category) ?? ""]);
  return `<item>${campos.map(([k, v]) => `<g:${k}>${escapar(v)}</g:${k}>`).join("")}</item>`;
}

/** `siteUrl` = URL canónica del sitio (sin barra final o con ella). */
export function feedGoogleXml(productos: readonly Product[], siteUrl: string): string {
  const sitio = siteUrl.replace(/\/$/, "");
  const items = productos.map((p) => item(p, sitio)).filter(Boolean).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>Productos</title>
<link>${escapar(sitio)}</link>
<description>Catálogo de la tienda</description>
${items}
</channel>
</rss>
`;
}
