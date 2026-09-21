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
  title: "Central LED — Tienda Online",
  description:
    "Iluminación LED y materiales eléctricos en Puerto Iguazú, Misiones. Stock en tiempo real.",
  verification: {
    other: {
      "facebook-domain-verification": "rlakqld8a1l4usoqjwmgo4yr1vsoln",
    },
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
        <ClerkProvider localization={esAR}>
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
