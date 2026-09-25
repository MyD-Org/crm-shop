import { SiteFooter as SiteFooterDS } from "@myd-org/ui";
import { envioHabilitado } from "@/lib/envio-flag";

/**
 * Footer global del layout. Textos del diseño aprobado; links a rutas reales. "Led" con el color de marca del tema
 * sobre oscuro y sin itálica (regla `.site-footer em` en globals.css), igual
 * que el header.
 */
export async function SiteFooter() {
  const anio = new Date().getFullYear();
  // "Envíos y pagos" sólo con el flag `envio` prendido.
  const envio = await envioHabilitado();
  return (
    <SiteFooterDS
      className="site-footer"
      brandName="Central"
      brandAccent="Led"
      description="Casa de electricidad e iluminación en Puerto Iguazú, Misiones. Del disyuntor al velador: el local de siempre, ahora también online."
      columns={[
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
            ...(envio ? [{ label: "Envíos y pagos", href: "/carrito" }] : []),
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
