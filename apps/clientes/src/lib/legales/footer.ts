/**
 * Columnas del footer global (`src/components/SiteFooter.tsx`), puras para
 * testear orden y hrefs sin DOM. "Envíos y pagos" vive en Legales y se
 * muestra siempre (no depende del flag `envio`).
 *
 * "Contacto" sale de la fila `footer` (editable desde la tienda, ver
 * `src/data/footer.ts`); "Mi cuenta" y "Legales" son fijas. Si Contacto queda
 * sin links, la columna no se muestra.
 */
import type { SiteFooterColumn, SiteFooterLink } from "@myd-org/ui";
import { DEFAULTS_FOOTER, hrefWhatsapp, linkLocal, type DatosFooter } from "@/data/footer";
import { URL_DEFENSA_CONSUMIDOR } from "./comun";

/** Links de la columna "Contacto". Los extra externos abren en otra pestaña. */
export function linksContacto(footer: DatosFooter): SiteFooterLink[] {
  return [
    ...(footer.whatsapp ? [{ label: "WhatsApp", href: hrefWhatsapp(footer.whatsapp) }] : []),
    ...footer.locales.flatMap((l) => {
      const link = linkLocal(l);
      return link ? [link] : [];
    }),
    ...footer.enlaces.map((e) => (e.href.startsWith("/") ? { ...e } : { ...e, external: true })),
  ];
}

export function columnasFooter(ctx: { arrepentimiento: boolean; footer?: DatosFooter }): SiteFooterColumn[] {
  const contacto = linksContacto(ctx.footer ?? DEFAULTS_FOOTER);
  return [
    {
      title: "Mi cuenta",
      links: [
        { label: "Mis pedidos", href: "/mi-cuenta" },
        { label: "Facturas", href: "/mi-cuenta" },
      ],
    },
    ...(contacto.length ? [{ title: "Contacto", links: contacto }] : []),
    {
      title: "Legales",
      links: [
        { label: "Términos y condiciones", href: "/terminos" },
        { label: "Política de privacidad", href: "/privacidad" },
        { label: "Envíos y pagos", href: "/envios-y-pagos" },
        ...(ctx.arrepentimiento ? [{ label: "Botón de arrepentimiento", href: "/arrepentimiento" }] : []),
        { label: "Defensa del Consumidor", href: URL_DEFENSA_CONSUMIDOR, external: true },
      ],
    },
  ];
}
