import { SiteFooter as SiteFooterDS } from "@myd-org/ui";
import { linkNext } from "@/components/catalogo/link-next";
import { getDatosLegales } from "@/lib/home-datos";
import { columnasFooter } from "@/lib/legales/footer";

/**
 * Footer global del layout. Textos del diseño aprobado; links a rutas reales. "Led" con el color de marca del tema
 * sobre oscuro y sin itálica (regla `.site-footer em` en globals.css), igual
 * que el header.
 *
 * Columnas en `src/lib/legales/footer.ts` (columna Legales incluida). El QR de
 * Data Fiscal se muestra solo si el admin cargó su enlace en "Datos legales".
 */
export async function SiteFooter() {
  const anio = new Date().getFullYear();
  const legal = await getDatosLegales();
  return (
    <SiteFooterDS
      className="site-footer"
      renderLink={linkNext}
      brandName="Central"
      brandAccent="Led"
      description="Casa de electricidad e iluminación en Puerto Iguazú, Misiones. Del disyuntor al velador: el local de siempre, ahora también online."
      columns={columnasFooter({ arrepentimiento: false })}
      barLeft={`© ${anio} Central Led — Puerto Iguazú, Misiones`}
      barRight="Av. República Argentina · Lun a Sáb"
      barExtra={
        legal.dataFiscalUrl ? (
          <a href={legal.dataFiscalUrl} target="_blank" rel="noopener noreferrer">
            {/* Imagen genérica de ARCA, local (public/images). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/data-fiscal.jpg" alt="Data Fiscal" width={40} height={54} />
          </a>
        ) : undefined
      }
    />
  );
}
