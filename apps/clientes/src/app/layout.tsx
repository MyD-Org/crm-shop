import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ClerkProvider } from "@clerk/nextjs";
import { esAR } from "@/lib/clerk-localizacion";
import { Fraunces, Nunito_Sans } from "next/font/google";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/HeaderServer";
import { SiteFooter } from "@/components/SiteFooter";
import { getContenidoHome } from "@/lib/home-datos";
import { TEMA_COOKIE } from "@/lib/tema-ip";
import "./globals.css";

const nunito = Nunito_Sans({
  subsets: ["latin"],
  variable: "--font-nunito",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
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
  // Tema por geo-IP (guía §5): la cookie la decide el proxy en la primera
  // visita (Misiones → azul de marca) y `?tema=` la puede forzar.
  const tema =
    (await cookies()).get(TEMA_COOKIE)?.value === "calido-azul"
      ? "calido-azul"
      : "calido";

  return (
    <html
      lang="es"
      data-theme={tema}
      className={`h-full antialiased ${nunito.variable} ${fraunces.variable}`}
    >
      <body className="flex min-h-full flex-col">
        {/* Fuentes del diseño aprobado (Sora + Nunito Sans, Google Fonts).
            React 19 las hoista al <head>. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Sora:wght@300..800&family=Nunito+Sans:ital,wght@0,300..900;1,300..900&display=swap"
          rel="stylesheet"
        />
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
