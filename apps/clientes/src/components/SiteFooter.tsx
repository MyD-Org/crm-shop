import { SiteFooter as SiteFooterDS } from "@myd-org/ui";
import { linkNext } from "@/components/catalogo/link-next";
import { BotonEditarFooter } from "@/components/footer/BotonEditarFooter";
import { textoBarra } from "@/data/footer";
import { identidadActual } from "@/lib/auth";
import { getDatosFooter, getDatosLegales } from "@/lib/home-datos";
import { columnasFooter } from "@/lib/legales/footer";

/**
 * Footer global del layout. "Led" con el color de marca del tema sobre oscuro
 * y sin itálica (regla `.site-footer em` en globals.css), igual que el header.
 *
 * Descripción, columna "Contacto" y textos de la barra salen de la fila
 * `footer` (editable desde la tienda; defaults = el footer de siempre, ver
 * `src/data/footer.ts`). Columnas en `src/lib/legales/footer.ts` ("Mi cuenta"
 * y "Legales" fijas). El QR de Data Fiscal se muestra solo si el admin cargó
 * su enlace en "Datos legales". Las filas `legal` y `footer` se leen juntas,
 * en una sola consulta por request.
 *
 * Admin: botón "Editar footer" arriba del footer. `identidadActual` ya la
 * resolvió el layout (está en `cache()`), así que no cuesta otra ida a Clerk.
 */
export async function SiteFooter() {
  const anio = new Date().getFullYear();
  const [legal, footer, identidad] = await Promise.all([getDatosLegales(), getDatosFooter(), identidadActual()]);
  return (
    <>
      {identidad.esAdmin ? (
        <div data-editor="" className="mx-auto flex w-full max-w-[1280px] justify-end px-4 pt-6">
          <BotonEditarFooter inicial={footer} />
        </div>
      ) : null}
      <SiteFooterDS
        className="site-footer"
        renderLink={linkNext}
        brandName="Central"
        brandAccent="Led"
        description={footer.descripcion}
        columns={columnasFooter({ arrepentimiento: true, footer })}
        barLeft={textoBarra(footer.barraIzquierda, anio)}
        barRight={textoBarra(footer.barraDerecha, anio)}
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
    </>
  );
}
