import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { ClerkProvider } from "@clerk/nextjs";
import { esAR } from "@/lib/clerk-localizacion";
import { Nunito_Sans, Sora } from "next/font/google";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/HeaderServer";
import { SiteFooter } from "@/components/SiteFooter";
import { getContenidoHome } from "@/lib/home-datos";
import { HEADER_TEMA, TEMA_COOKIE } from "@/lib/tema-ip";
import "./globals.css";

// Fuentes del diseño aprobado, self-hosted vía next/font; la paleta cálida las
// consume como var(--font-nunito) / var(--font-sora) desde globals.css.
const nunito = Nunito_Sans({
  subsets: ["latin"],
  style: ["normal", "italic"],
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
    "Iluminación LED y materiales eléctricos en Puerto Iguazú, Misiones. Stock en tiempo real.",
  verification: {
    other: {
      "facebook-domain-verification": "rlakqld8a1l4usoqjwmgo4yr1vsoln",
    },
  },
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Anuncio global: contenido administrable del CRM (mismo contrato que la home).
  const { anuncio } = await getContenidoHome();
  // Tema por geo-IP (guía §5): el proxy decide en la primera visita
  // (Misiones → azul de marca) y `?tema=` la puede forzar. El header
  // x-centralled-tema trae la decisión de ESTE request y manda sobre la
  // cookie, que recién se actualiza en la response: sin él, forzar el tema
  // tardaría un request en verse.
  const headerTema = (await headers()).get(HEADER_TEMA);
  const cookieTema = (await cookies()).get(TEMA_COOKIE)?.value;
  const tema =
    headerTema === "calido" || headerTema === "calido-azul"
      ? headerTema
      : cookieTema === "calido-azul"
        ? "calido-azul"
        : "calido";

  return (
    <html
      lang="es"
      data-theme={tema}
      className={`h-full antialiased ${nunito.variable} ${sora.variable}`}
    >
      <body className="flex min-h-full flex-col">
        {/* ClerkProvider DENTRO de <body>: envolver <html> fuerza render dinámico de todo el árbol */}
        <ClerkProvider localization={esAR} appearance={aparienciaClerk}>
          <Providers>
            {/* Anuncio global (contenido administrable): arriba de todo, sobre el header */}
            <div className="bg-primary px-4 py-2.5 text-center text-[12.5px] font-semibold tracking-wide text-on-primary">
              {anuncio.texto}
            </div>
            <Header />
            {children}
            <SiteFooter />
          </Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
