/**
 * Columnas del footer global (`src/components/SiteFooter.tsx`), puras para
 * testear orden y hrefs sin DOM. "Envíos y pagos" vive en Legales y se
 * muestra siempre (no depende del flag `envio`).
 */
import type { SiteFooterColumn } from "@myd-org/ui";
import { URL_DEFENSA_CONSUMIDOR } from "./comun";

export function columnasFooter(ctx: { arrepentimiento: boolean }): SiteFooterColumn[] {
  return [
    {
      title: "Mi cuenta",
      links: [
        { label: "Mis pedidos", href: "/mi-cuenta" },
        { label: "Facturas", href: "/mi-cuenta" },
      ],
    },
    {
      title: "Contacto",
      links: [
        { label: "WhatsApp", href: "https://wa.me/5492235903025" },
        {
          label: "Ubicación",
          href: "https://www.google.com/maps/search/?api=1&query=Av.+Rep%C3%BAblica+Argentina%2C+Puerto+Iguaz%C3%BA%2C+Misiones",
        },
      ],
    },
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
