import { Suspense } from "react";
import { cacheLife } from "next/cache";
import { SiteFooter as SiteFooterDS } from "@myd-org/ui";
import { linkNext } from "@/components/catalogo/link-next";
import { BotonEditarFooterSiAdmin } from "@/components/footer/BotonEditarFooterSiAdmin";
import { textoBarra } from "@/data/footer";
import { getDatosFooter, getDatosLegales } from "@/lib/home-datos";
import { columnasFooter } from "@/lib/legales/footer";
import { getTarjetasMercadoPago } from "@/lib/pagos/tarjetas-aceptadas-mp";

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
 * Va en el shell estático (Cache Components): los datos salen de
 * `'use cache'` y el año también, así no hace falta un request para pintarlo.
 *
 * En mobile no se muestra en las páginas con una barra fija abajo (ficha,
 * carrito, checkout): ver `[data-sin-footer-mobile]` en globals.css.
 *
 * "Medios de pago": logos de las tarjetas que acepta Mercado Pago en la cuenta (`getTarjetasMercadoPago`,
 * cacheado por días). Si Mercado Pago no responde, la fila no se muestra.
 *
 * Admin: botón "Editar footer" arriba del footer, en un hueco aparte
 * (`BotonEditarFooterSiAdmin` dentro de `<Suspense fallback={null}>`).
 */
export async function SiteFooter() {
  const [anio, legal, footer, tarjetas] = await Promise.all([
    anioActual(),
    getDatosLegales(),
    getDatosFooter(),
    getTarjetasMercadoPago(),
  ]);
  // Crédito y débito juntos, sin repetir logos (algunas marcas usan el mismo para los dos).
  const logos = [...tarjetas.credito, ...tarjetas.debito]
    .filter((t, i, todas) => todas.findIndex((o) => o.logo === t.logo) === i)
    .map((t) => ({ name: t.nombre, src: t.logo }));
  return (
    <div className="footer-global">
      <Suspense fallback={null}>
        <BotonEditarFooterSiAdmin inicial={footer} />
      </Suspense>
      <SiteFooterDS
        className="site-footer"
        renderLink={linkNext}
        brandName="Central"
        brandAccent="Led"
        description={footer.descripcion}
        columns={columnasFooter({ arrepentimiento: true, footer })}
        barLeft={textoBarra(footer.barraIzquierda, anio)}
        barRight={textoBarra(footer.barraDerecha, anio)}
        payments={{ title: "Medios de pago", logos }}
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
    </div>
  );
}

/**
 * Año de la barra inferior. `new Date()` en el prerender tiene que vivir en un
 * scope cacheado (si no, el build lo rechaza): se recalcula una vez por día.
 */
async function anioActual(): Promise<number> {
  "use cache";
  cacheLife("days");
  return new Date().getFullYear();
}
