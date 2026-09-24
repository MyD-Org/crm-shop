import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { ClerkProvider } from "@clerk/nextjs";
import { esAR } from "@/lib/clerk-localizacion";
import { Nunito_Sans, Sora } from "next/font/google";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/HeaderServer";
import { SiteFooter } from "@/components/SiteFooter";
import { getContenidoHome } from "@/lib/home-datos";
import { clasesVisibilidad, visibilidadDe } from "@/data/home-defaults";
import { identidadActual } from "@/lib/auth";
import { GEO_IP_ACTIVO, HEADER_TEMA, TEMA_COOKIE, TEMA_POR_DEFECTO } from "@/lib/tema-ip";
import { propsChatIa } from "@/lib/chat-ia";
import { ChatIa } from "@/components/chat/ChatIa";
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
  const { anuncio, visibilidad } = await getContenidoHome();
  const vAnuncio = visibilidadDe(visibilidad, "anuncio");
  // Favoritos se guardan por usuario de Clerk: quien entra sólo con la cookie
  // del CRM no tiene dónde guardarlos y no ve el corazón. `identidadActual`
  // está en `cache()`: el Header la resuelve en el mismo request.
  const identidad = await identidadActual();
  // Chat con el agente (flag `chat-ia`, apagado por defecto): sin flag o sin
  // config de ai-api es null y no se monta nada. Detrás del gate "Próximamente"
  // tampoco aparece: el proxy responde el gate antes de llegar a este layout.
  const chat = await propsChatIa();
  const favoritosBloqueados = !identidad.clerkUserId && !!identidad.cliente;
  // Tema por geo-IP (guía §5; hoy apagada → todos azul, ver tema-ip.ts): el proxy decide en la primera visita
  // (Misiones → azul de marca) y `?tema=` la puede forzar. El header
  // x-centralled-tema trae la decisión de ESTE request y manda sobre la
  // cookie, que recién se actualiza en la response: sin él, forzar el tema
  // tardaría un request en verse.
  const headerTema = (await headers()).get(HEADER_TEMA);
  const cookieTema = (await cookies()).get(TEMA_COOKIE)?.value;
  const tema =
    headerTema === "calido" || headerTema === "calido-azul"
      ? headerTema
      : !GEO_IP_ACTIVO
        ? TEMA_POR_DEFECTO
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
          <Providers favoritosBloqueados={favoritosBloqueados}>
            {/* Anuncio global (contenido administrable): arriba de todo, sobre el header.
                Dónde se ve lo decide el editor (default: solo desktop, porque en
                mobile el texto ocupa varias filas hasta que sea un carrusel). */}
            {vAnuncio === "nunca" || !anuncio.texto ? null : (
              <div className={`bg-primary px-4 py-2.5 text-center text-[12.5px] font-semibold tracking-wide text-on-primary ${clasesVisibilidad(vAnuncio)}`}>
                {anuncio.texto}
              </div>
            )}
            <Header />
            {children}
            <SiteFooter />
            {chat ? <ChatIa {...chat} /> : null}
          </Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
