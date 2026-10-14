/**
 * JSON-LD `Organization` + `WebSite` de la home (mismo criterio de escape que
 * `producto-jsonld.ts`). Nombre de la tienda: el mismo texto que `metadata.title` (la marca,
 * `marca.titulo`), que le pasa quien llama.
 *
 * Sólo estático: sin `NEXT_PUBLIC_SITE_URL` no hay `url` que declarar (una
 * Organization sin `url` no aporta nada) y se omite el bloque entero.
 */

export interface JsonLdSitio {
  "@context": "https://schema.org";
  "@graph": [
    { "@type": "Organization"; name: string; url: string },
    { "@type": "WebSite"; name: string; url: string },
  ];
}

/** `undefined` sin `siteUrl` (sin base no hay nada útil que declarar). */
export function jsonLdSitio(siteUrl: string | undefined, nombreTienda: string): JsonLdSitio | undefined {
  if (!siteUrl) return undefined;
  const url = siteUrl.replace(/\/$/, "");
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", name: nombreTienda, url },
      { "@type": "WebSite", name: nombreTienda, url },
    ],
  };
}

/** Serializado y escapado contra `</script>`, o `undefined` sin `siteUrl`. */
export function jsonLdSitioHtml(siteUrl: string | undefined, nombreTienda: string): string | undefined {
  const jsonLd = jsonLdSitio(siteUrl, nombreTienda);
  return jsonLd ? JSON.stringify(jsonLd).replace(/</g, "\\u003c") : undefined;
}
