import type { Metadata } from "next";
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
        <Providers>
          <Header />
          {children}
        </Providers>
      </body>
    </html>
  );
}
