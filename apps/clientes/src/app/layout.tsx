import { Suspense } from "react";
import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { esAR } from "@/lib/clerk-localizacion";
import { Nunito_Sans, Sora } from "next/font/google";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/HeaderServer";
import { SiteFooter } from "@/components/SiteFooter";
import { getContenidoHome } from "@/lib/home-datos";
import { clasesVisibilidad, visibilidadDe } from "@/data/home-defaults";
import { TEMA_POR_DEFECTO, scriptTema } from "@/lib/tema-ip";
import { BloqueoFavoritos } from "@/components/BloqueoFavoritos";
import { ChatIaServidor } from "@/components/chat/ChatIaServidor";
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

export const metadata: Metadata = {
  // Base de las URLs absolutas de metadata (canonical). Por entorno: el repo
  // no lleva el dominio. Sin la variable, las páginas omiten el canonical.
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL
    ? new URL(process.env.NEXT_PUBLIC_SITE_URL)
    : undefined,
  title: "Central LED — Tienda Online",
  description:
    "Iluminación, materiales eléctricos, herramientas y mucho más en Puerto Iguazú, Misiones. Stock en tiempo real.",
  // Verificación del dominio en Meta: el token es de la cuenta de la tienda y
  // va por entorno (repo público). Sin la variable no se emite el meta.
  ...(process.env.FACEBOOK_DOMAIN_VERIFICATION
    ? {
        verification: {
          other: { "facebook-domain-verification": process.env.FACEBOOK_DOMAIN_VERIFICATION },
        },
      }
    : {}),
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
 * identidad y nav en el header, bloqueo de favoritos, chat (flag `chat-ia`) y
 * la página misma.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Anuncio global: contenido administrable (mismo contrato que la home).
  const { anuncio, visibilidad } = await getContenidoHome();
  const vAnuncio = visibilidadDe(visibilidad, "anuncio");

  return (
    // Tema: el shell trae el de todos (geo-IP apagada, ver tema-ip.ts). El
    // `?tema=azul|calido` de QA lo aplica el script del <head> antes del primer
    // pintado; por eso `suppressHydrationWarning` en <html>.
    <html
      lang="es"
      data-theme={TEMA_POR_DEFECTO}
      suppressHydrationWarning
      className={`h-full antialiased ${nunito.variable} ${sora.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: scriptTema() }} />
      </head>
      <body className="flex min-h-full flex-col">
        {/* ClerkProvider DENTRO de <body> y sin `dynamic`: con `dynamic` (o
            envolviendo <html>) todo el árbol pasa a depender del request. */}
        <ClerkProvider localization={esAR} appearance={aparienciaClerk}>
          <Providers>
            {/* Anuncio global (contenido administrable): arriba de todo, sobre el header.
                Dónde se ve lo decide el editor (default: solo desktop, porque en
                mobile el texto ocupa varias filas hasta que sea un carrusel). */}
            {vAnuncio === "nunca" || !anuncio.texto ? null : (
              <div className={`bg-primary px-4 py-2.5 text-center text-[12.5px] font-semibold tracking-wide text-on-primary ${clasesVisibilidad(vAnuncio)}`}>
                {anuncio.texto}
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
          </Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
