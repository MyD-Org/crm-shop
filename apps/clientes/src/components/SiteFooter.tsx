import { SiteFooter as SiteFooterDS } from "@myd-org/ui";

/**
 * Footer global del layout. Links reales (el footer anterior tenía hrefs rotos
 * a /cuenta/* y /envios). Rubros hardcodeados: son las categorías canónica del
 * negocio (mismo criterio que el footer viejo).
 */
export function SiteFooter() {
  const anio = new Date().getFullYear();
  return (
    <SiteFooterDS
      brandName="Central"
      brandAccent="Led"
      description="Materiales eléctricos e iluminación en Puerto Iguazú, Misiones, con amor por la luz."
      columns={[
        {
          title: "Rubros",
          links: [
            { label: "Iluminación LED", href: "/catalogo?categoria=Iluminaci%C3%B3n+LED" },
            { label: "Tableros", href: "/catalogo?categoria=Tableros" },
            { label: "Cables", href: "/catalogo?categoria=Cables" },
            { label: "Automatización", href: "/catalogo?categoria=Automatizaci%C3%B3n" },
          ],
        },
        {
          title: "Mi cuenta",
          links: [
            { label: "Mis pedidos", href: "/mi-cuenta" },
            { label: "Cuenta corriente", href: "/mi-cuenta/vincular" },
          ],
        },
        {
          title: "Contacto",
          links: [
            { label: "WhatsApp", href: "https://wa.me/5492235903025" },
            { label: "Catálogo", href: "/catalogo" },
            { label: "Carrito", href: "/carrito" },
          ],
        },
      ]}
      barLeft={`© ${anio} Central Led — Puerto Iguazú, Misiones`}
      barRight="Hecho con luz en Misiones"
    />
  );
}
