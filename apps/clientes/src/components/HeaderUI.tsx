"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Show, SignInButton } from "@clerk/nextjs";
import { SiteHeader } from "@myd-org/ui";
import type { NavBadgeContent } from "@/data/home-defaults";
import { SearchAutocomplete } from "./SearchAutocomplete";
import { destinoSeguro } from "@/lib/ingreso";
import { MAX_CATEGORIAS_NAV, conBadgeNav } from "@/lib/nav-badge";
import { formatRubro } from "@/lib/formato-rubro";
import { CartPreview } from "./CartPreview";
import { MenuUsuario } from "./MenuUsuario";

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

  // La barra de categorías va SÓLO en la home. En /catalogo el panel de
  // filtros hace ese trabajo y mejor —es exhaustivo y dice cuántos productos
  // hay en cada categoría—, así que ahí repetía cuatro nombres de más; en el
  // resto del sitio (ficha, carrito, Mi cuenta) no aporta y suma 52px de alto
  // en todas las páginas.
  const nav =
    pathname === "/"
      ? conBadgeNav(
          categorias.slice(0, MAX_CATEGORIAS_NAV).map((cat) => ({
            label: formatRubro(cat),
            href: `/catalogo?categoria=${encodeURIComponent(cat)}`,
          })),
          navBadge,
        )
      : [];

  // Cuál de las dos instancias del carrito está a la vista (ver compactActions).
  const [compacto, setCompacto] = useState(false);

  return (
    <div className="bg-bg">
      {/* La barra de anuncio vive en src/app/layout.tsx (global desde e88aec5,
          contenido administrable); acá solo va el header+nav globales. */}
      <SiteHeader
        brandPlacement="start"
        compactOnScroll
        onCompactChange={setCompacto}
        // El preview del carrito se abre solo al agregar: con dos instancias
        // montadas, sólo la que está a la vista debe abrirse.
        compactActions={<CartPreview autoAbrir={compacto} />}
        brandName="Central"
        brandAccent="Led"
        brandSub="Iluminación · Electricidad"
        search={<SearchAutocomplete />}
        nav={nav}
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
              {/*
                Un solo avatar con menú propio (Mis pedidos / Mis datos /
                Seguridad / Cerrar sesión). Los datos y la seguridad siguen
                siendo el panel de Clerk: ver src/components/MenuUsuario.tsx.
              */}
              <MenuUsuario nombre={nombre} />
            </Show>

            <CartPreview autoAbrir={!compacto} />
          </>
        }
      />
    </div>
  );
}
