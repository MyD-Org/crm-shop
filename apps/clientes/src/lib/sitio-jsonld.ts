/**
 * JSON-LD `Organization` + `WebSite` de la home (mismo criterio de escape que
 * `producto-jsonld.ts`). Nombre de la tienda: el mismo texto que ya usa
 * `metadata.title` en `src/app/layout.tsx` — no hay una constante compartida
 * hoy, así que se repite acá literal en vez de importar del layout (el layout
 * no exporta nada, y armar un ciclo de importación por un string no vale la
 * pena). Si el nombre cambia, tocar los dos lugares.
 *
 * Sólo estático: sin `NEXT_PUBLIC_SITE_URL` no hay `url` que declarar (una
 * Organization sin `url` no aporta nada) y se omite el bloque entero.
 */

const NOMBRE_TIENDA = "Central LED — Tienda Online";

export interface JsonLdSitio {
  "@context": "https://schema.org";
  "@graph": [
    { "@type": "Organization"; name: string; url: string },
    { "@type": "WebSite"; name: string; url: string },
  ];
}

/** `undefined` sin `siteUrl` (sin base no hay nada útil que declarar). */
export function jsonLdSitio(siteUrl: string | undefined): JsonLdSitio | undefined {
  if (!siteUrl) return undefined;
  const url = siteUrl.replace(/\/$/, "");
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", name: NOMBRE_TIENDA, url },
      { "@type": "WebSite", name: NOMBRE_TIENDA, url },
    ],
  };
}

/** Serializado y escapado contra `</script>`, o `undefined` sin `siteUrl`. */
export function jsonLdSitioHtml(siteUrl: string | undefined): string | undefined {
  const jsonLd = jsonLdSitio(siteUrl);
  return jsonLd ? JSON.stringify(jsonLd).replace(/</g, "\\u003c") : undefined;
}
