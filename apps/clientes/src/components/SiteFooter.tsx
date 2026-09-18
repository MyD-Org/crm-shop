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
          title: "Tienda",
          links: [
            { label: "Catálogo", href: "/catalogo" },
            { label: "Carrito", href: "/carrito" },
            { label: "Ingresar", href: "/ingresar" },
          ],
        },
        {
          title: "Mi cuenta",
          links: [
            { label: "Mis pedidos", href: "/mi-cuenta" },
            { label: "Vincular mi cuenta", href: "/mi-cuenta/vincular" },
          ],
        },
      ]}
      barLeft={`© ${anio} Central Led — Puerto Iguazú, Misiones`}
      barRight="Hecho con luz en Misiones"
    />
  );
}
