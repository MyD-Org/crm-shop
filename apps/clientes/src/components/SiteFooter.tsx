import { SiteFooter as SiteFooterDS } from "@myd-org/ui";

/**
 * Footer global del layout. Textos del diseño aprobado; links a rutas reales
 * (categorías canónicas del catálogo). "Led" en highlight (--warm) sin itálica,
 * como el mockup (el DS lo itálica por defecto).
 */
export function SiteFooter() {
  const anio = new Date().getFullYear();
  return (
    <SiteFooterDS
      className="[&_em]:not-italic"
      brandName="Central"
      brandAccent="Led"
      description="Casa de electricidad e iluminación en Puerto Iguazú, Misiones. Del disyuntor al velador: el local de siempre, ahora también online."
      columns={[
        {
          title: "Rubros",
          links: [
            { label: "Iluminación LED", href: "/catalogo?categoria=ILUMINACION" },
            { label: "Línea decorativa", href: "/catalogo?categoria=ILUMINACION" },
            { label: "Electricidad", href: "/catalogo?categoria=ELECTRICIDAD" },
            { label: "Automatización", href: "/catalogo?categoria=ELECTRICIDAD" },
          ],
        },
        {
          title: "Mi cuenta",
          links: [
            { label: "Mis pedidos", href: "/mi-cuenta" },
            { label: "Cuenta corriente", href: "/mi-cuenta/vincular" },
            { label: "Facturas", href: "/mi-cuenta" },
          ],
        },
        {
          title: "Contacto",
          links: [
            { label: "WhatsApp", href: "https://wa.me/5492235903025" },
            { label: "Envíos y pagos", href: "/carrito" },
            {
              label: "Ubicación",
              href: "https://www.google.com/maps/search/?api=1&query=Av.+Rep%C3%BAblica+Argentina%2C+Puerto+Iguaz%C3%BA%2C+Misiones",
            },
          ],
        },
      ]}
      barLeft={`© ${anio} Central Led — Puerto Iguazú, Misiones`}
      barRight="Av. República Argentina · Lun a Sáb"
    />
  );
}
