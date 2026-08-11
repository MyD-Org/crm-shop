import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { esAR } from "@/lib/clerk-localizacion";
import "./globals.css";
import { Header } from "@/components/HeaderServer";
import { Providers } from "@/components/Providers";

export const metadata: Metadata = {
  title: "Central LED — Tienda Online",
  description:
    "Iluminación LED, materiales eléctricos y más. Precios mayoristas, stock en tiempo real.",
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
    <html lang="es" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        {/*
          ClerkProvider va DENTRO de <body>, no envolviendo <html>: en Next 16
          envolver el documento entero fuerza render dinámico de todo el árbol.
          La localización es castellano rioplatense: Clerk solo trae es-ES, que
          trata de usted y desentona con el resto del sitio.
        */}
        <ClerkProvider localization={esAR}>
          <Providers>
            <Header />
            {children}
          </Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
