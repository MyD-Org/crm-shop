import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { esAR } from "@/lib/clerk-localizacion";
import { Fraunces, Nunito_Sans } from "next/font/google";
import { Header } from "@/components/HeaderServer";
import { SiteFooter } from "@/components/SiteFooter";
import { Providers } from "@/components/Providers";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      data-theme="editorial"
      className={`h-full antialiased ${nunito.variable} ${fraunces.variable}`}
    >
      <body className="flex min-h-full flex-col">
        {/* ClerkProvider DENTRO de <body>: envolver <html> fuerza render dinámico de todo el árbol */}
        <ClerkProvider localization={esAR}>
          <Providers>
            <Header />
            {children}
            <SiteFooter />
          </Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
