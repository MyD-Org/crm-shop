"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { SiteHeader } from "@myd-org/ui";
import type { NavBadgeContent } from "@/data/home-defaults";
import { SearchAutocomplete } from "./SearchAutocomplete";
import { destinoSeguro } from "@/lib/ingreso";
import { conBadgeNav } from "@/lib/nav-badge";
import { CartPreview } from "./CartPreview";

function UserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function HeaderUI({
  nombre,
  categorias,
  navBadge = null,
}: {
  /** Razon social del cliente, o el nombre de la cuenta. null = anonimo. */
  nombre: string | null;
  /** Categorias reales del catalogo, resueltas en HeaderServer. */
  categorias: string[];
  /** Badge administrable del nav: se pega al item de `categoria`. */
  navBadge?: NavBadgeContent | null;
}) {
  const pathname = usePathname();
  // En "Mi cuenta" ocultamos la barra de categorias para que se sienta una
  // seccion propia y no de tienda.
  const hideCategorias = pathname?.startsWith("/mi-cuenta");

  return (
    <div className="bg-bg">
      {/* La barra de anuncio vive en la home (contenido administrable); acá solo
          va el header+nav globales. */}
      <SiteHeader
        className="site-header"
        brandName="Central"
        brandAccent="Led"
        brandSub="Iluminación · Electricidad"
        search={<SearchAutocomplete />}
        actions={
          <>
            <Show when="signed-out">
              {/*
                `mode="modal"` en vez de navegar a /ingresar: el cliente puede
                estar a mitad del carrito, y sacarlo de la pagina para loguearse
                es donde se pierden las compras.
              */}
              <SignInButton
                mode="modal"
                fallbackRedirectUrl={destinoSeguro(pathname)}
                signUpFallbackRedirectUrl={destinoSeguro(pathname)}
              >
                <button className="flex items-center gap-2 text-[13.5px] font-bold text-text transition-colors hover:text-accent">
                  <UserIcon />
                  Ingresá
                </button>
              </SignInButton>
            </Show>

            <Show when="signed-in">
              <Link
                href="/mi-cuenta"
                className="flex items-center gap-2 text-[13.5px] font-bold text-text transition-colors hover:text-accent"
              >
                <UserIcon />
                <span className="hidden max-w-[14ch] truncate sm:inline">
                  {nombre ?? "Mi cuenta"}
                </span>
              </Link>
              <UserButton />
            </Show>

            <CartPreview />
          </>
        }
        nav={
          hideCategorias
            ? []
            : conBadgeNav(
                categorias.slice(0, 8).map((cat) => ({
                  label: cat,
                  href: `/catalogo?categoria=${encodeURIComponent(cat)}`,
                })),
                navBadge,
              )
        }
      />
    </div>
  );
}
