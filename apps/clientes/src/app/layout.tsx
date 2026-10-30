import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { esAR } from "@/lib/clerk-localizacion";
import { Nunito_Sans, Sora } from "next/font/google";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/HeaderServer";
import { SiteFooter } from "@/components/SiteFooter";
import { RedesSociales } from "@/components/footer/RedesSociales";
import { hrefWhatsapp } from "@/data/footer";
import { getContenidoHome, getDatosFooter } from "@/lib/home-datos";
import { clasesVisibilidad, visibilidadDe } from "@/data/home-defaults";
import { scriptTema } from "@/lib/tema-ip";
import { atributosHtmlTema } from "@/lib/tema-tenant";
import { getTemaTenant } from "@/lib/tema-tenant-datos";
import { BloqueoFavoritos } from "@/components/BloqueoFavoritos";
import { ChatIaServidor } from "@/components/chat/ChatIaServidor";
import { TrackingServidor } from "@/components/tracking/TrackingServidor";
import { MarcaProvider } from "@/components/MarcaProvider";
import { PromoProvider } from "@/components/promociones/PromoProvider";
import { datosPromoCliente } from "@/lib/promociones/promo";
import { getMarca } from "@/lib/marca";
import { metadataDeMarca } from "@/lib/metadata-marca";
import "./globals.css";

// Fuentes del diseño aprobado, self-hosted vía next/font; la paleta cálida las
// consume como var(--font-nunito) / var(--font-sora) desde globals.css.
// Nunito sólo en normal: ningún texto de la tienda la usa en itálica (los <em>
// del DS van en font-display o con not-italic), y la itálica era una tercera
// fuente precargada en todas las páginas. Si algún texto en Nunito pasa a
// necesitarla, volver a pedir style: ["normal", "italic"] (sin ella el
// navegador la simula inclinando la normal).
const nunito = Nunito_Sans({
  subsets: ["latin"],
  variable: "--font-nunito",
});

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
});

/**
 * Metadata del sitio: título, descripción y verificación de Meta salen de la marca de la tienda
 * (`tenants.shop_marca`, cacheada; ver src/lib/marca.ts). Con la marca de Central es el `metadata`
 * de siempre (src/lib/metadata-marca.test.ts).
 */
export async function generateMetadata(): Promise<Metadata> {
  return metadataDeMarca(await getMarca(), {
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    facebookToken: process.env.FACEBOOK_DOMAIN_VERIFICATION,
  });
}

/**
 * `viewport-fit=cover`: la página ocupa también el área de la muesca y del
 * indicador de inicio, y `env(safe-area-inset-*)` deja de valer 0. Lo pide la
 * hoja mobile del chat (ai-widget 0.8.0) y lo usan las barras fijas de abajo
 * (ficha, carrito, avisos, visor de fotos). Los costados los cubre el
 * `padding` del `<body>` en globals.css. Ancho y escala, los de siempre.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * Apariencia de los componentes de Clerk (SignIn, UserProfile, UserButton…)
 * cableada a los tokens del tema editorial. Los componentes renderizan dentro
 * del mismo árbol tematizado, así que las CSS vars del DS (--color-*, definidas
 * en @myd-org/ui y activadas con data-theme en <html>) resuelven directo.
 */
const aparienciaClerk = {
  variables: {
    colorPrimary: "var(--color-primary)",
    colorBackground: "var(--color-surface)",
    colorInputBackground: "var(--color-bg)",
    colorText: "var(--color-text)",
    colorTextSecondary: "var(--color-muted)",
    colorDanger: "var(--color-danger)",
    fontFamily: "var(--font-sans)",
    borderRadius: "0.5rem",
  },
  elements: {
    // Las tarjetas del sitio no usan sombra: solo borde.
    card: "shadow-none",
  },
};

/**
 * Layout raíz, parte del shell estático (Cache Components): no lee cookies ni
 * headers. El contenido administrable (anuncio, badge, footer) sale de
 * `'use cache'`; lo que depende del visitante va en huecos con `<Suspense>`:
 * identidad y nav en el header, bloqueo de favoritos, chat (flag `chat-ia`),
 * tracking (flag `tracking`) y la página misma.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Anuncio global: contenido administrable (mismo contrato que la home).
  const [{ anuncio, visibilidad, promociones }, marca, temaTenant, footer] = await Promise.all([
    getContenidoHome(),
    getMarca(),
    getTemaTenant(),
    getDatosFooter(),
  ]);
  // Promo de la home para badges y ficha (la vigencia la decide el cliente). Apagada en el editor: no viaja.
  const datosPromo = visibilidadDe(visibilidad, "promociones") === "nunca" ? null : datosPromoCliente(promociones);
  // Tema de la tienda (`tenants.shop_tema`): sin paleta propia (Central) no hay `data-tema` ni
  // `<style>` y el HTML es el de siempre; con ella, UNA regla de variables (src/lib/tema-tenant.ts).
  const tema = atributosHtmlTema(temaTenant);
  const vAnuncio = visibilidadDe(visibilidad, "anuncio");
  const hayAnuncio = vAnuncio !== "nunca" && !!anuncio.texto;
  const { redes } = footer;
  const whatsapp = footer.whatsapp ? hrefWhatsapp(footer.whatsapp) : null;
  const hayRedes = redes.length > 0 || !!whatsapp;

  return (
    // Tema: el shell trae el de la tienda (base de `shop_tema`; geo-IP apagada, ver
    // tema-ip.ts). El `?tema=azul|calido` de QA lo aplica el script del <head> antes del primer
    // pintado; por eso `suppressHydrationWarning` en <html>.
    <html
      lang="es"
      data-theme={tema.dataTheme}
      data-tema={tema.dataTema}
      suppressHydrationWarning
      className={`h-full antialiased ${nunito.variable} ${sora.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: scriptTema() }} />
        {tema.css ? <style dangerouslySetInnerHTML={{ __html: tema.css }} /> : null}
      </head>
      <body className="flex min-h-full flex-col">
        {/* ClerkProvider DENTRO de <body> y sin `dynamic`: con `dynamic` (o
            envolviendo <html>) todo el árbol pasa a depender del request. */}
        <ClerkProvider localization={esAR} appearance={aparienciaClerk}>
          <Providers>
           <MarcaProvider marca={{ base: marca.base, nombre: marca.nombre, lema: marca.lema, logoUrl: marca.logoUrl }}>
           <PromoProvider datos={datosPromo}>
            {/* Barra superior: anuncio global (contenido administrable) al medio y
                cuentas de Instagram (`redes` del footer) y WhatsApp a la derecha. Dónde se ve el
                anuncio lo decide el editor (default: solo desktop, porque en mobile el
                texto ocupa varias filas hasta que sea un carrusel); las redes se ven
                siempre: en mobile, centradas debajo del anuncio. Sin anuncio visible
                ni redes, no hay barra. Grilla: con un anuncio largo, el texto se achica
                y parte línea; las redes conservan su ancho a la derecha. */}
            {!hayAnuncio && !hayRedes ? null : (
              <div
                className={`bg-primary text-on-primary ${!hayRedes ? clasesVisibilidad(vAnuncio) : ""}`}
              >
                <div className="mx-auto flex max-w-contenido flex-col items-center gap-1.5 px-[clamp(18px,4vw,48px)] py-2.5 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,max-content)_minmax(max-content,1fr)] md:gap-4">
                  <span aria-hidden className="max-md:hidden" />
                  {hayAnuncio ? (
                    <p className={`text-center text-[12.5px] font-semibold tracking-wide ${clasesVisibilidad(vAnuncio)}`}>
                      {anuncio.texto}
                    </p>
                  ) : (
                    <span aria-hidden className="max-md:hidden" />
                  )}
                  <RedesSociales redes={redes} whatsapp={whatsapp} className="justify-center md:flex-nowrap md:justify-end" />
                </div>
              </div>
            )}
            <Header />
            {/* Red de seguridad: una página que lea el request arriba de todo
                (Mi cuenta, checkout, carrito) queda como hueco entero en vez
                de romper el prerender. El fallback ocupa el alto de la
                pantalla para que el footer no suba mientras llega. */}
            <Suspense fallback={<main className="min-h-dvh flex-1" />}>{children}</Suspense>
            <SiteFooter />
            <Suspense fallback={null}>
              <BloqueoFavoritos />
            </Suspense>
            <Suspense fallback={null}>
              <ChatIaServidor />
            </Suspense>
            <Suspense fallback={null}>
              <TrackingServidor />
            </Suspense>
           </PromoProvider>
           </MarcaProvider>
          </Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
