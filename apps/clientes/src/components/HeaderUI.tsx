"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { SiteHeader, type VisibleOn } from "@myd-org/ui";
import type { NavBadgeContent } from "@/data/home-defaults";
import { SearchAutocomplete } from "./SearchAutocomplete";
import { destinoSeguro } from "@/lib/ingreso";
import { useHidratado } from "@/lib/hidratado";
import { MAX_CATEGORIAS_NAV, conBadgeNav } from "@/lib/nav-badge";
import { formatRubro } from "@/lib/formato-rubro";
import { CartPreview } from "./CartPreview";
import { linkNext } from "./catalogo/link-next";
import { MenuUsuario } from "./MenuUsuario";

function UserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

/**
 * Quién mira, según el servidor. `pendiente` = el shell estático, antes de que
 * el hueco del header resuelva la identidad (ver HeaderServer.tsx).
 */
export type CuentaHeader =
  | { estado: "pendiente" }
  | {
      estado: "resuelta";
      /** Razon social del cliente, o el nombre de la cuenta. null = anonimo. */
      nombre: string | null;
      /** Hay sesión de Clerk (la cookie del CRM sola no cuenta: no tiene menú). */
      conSesion: boolean;
    };

/** Alto de la barra de categorías del DS (52px + borde). */
const RESERVA_NAV = "h-[53px]";

interface PropsHeader {
  cuenta: CuentaHeader;
  /** Categorias reales del catalogo, resueltas en HeaderServer. null = cargando. */
  categorias: string[] | null;
  /** Badge administrable del nav: se pega al item de `categoria`. */
  navBadge?: NavBadgeContent | null;
  /** El badge sólo en mobile o en desktop (visibilidad del editor). */
  navBadgeVisibleOn?: VisibleOn;
}

/** Header con la ruta actual (nav de la home, cierre del preview del carrito). */
export function HeaderUI(props: PropsHeader) {
  return <HeaderVista {...props} pathname={usePathname()} />;
}

/**
 * El mismo header sin leer la ruta. `usePathname` suspende en el prerender de
 * una ruta con parámetros (ficha, pedido, ingreso): para esas, el shell
 * estático usa esta versión (sin nav, que sólo va en la home) hasta que llega
 * el hueco del header. Ver HeaderServer.tsx.
 */
export function HeaderSinRuta(props: PropsHeader) {
  return <HeaderVista {...props} pathname={null} />;
}

/** Destino tras ingresar: la ruta actual (sin ruta todavía, la del navegador). */
function destinoIngreso(pathname: string | null) {
  return destinoSeguro(pathname ?? (typeof window === "undefined" ? "/" : window.location.pathname));
}

function HeaderVista({
  cuenta,
  categorias,
  navBadge = null,
  navBadgeVisibleOn,
  pathname,
}: PropsHeader & { pathname: string | null }) {

  // La barra de categorías va SÓLO en la home. En /catalogo el panel de
  // filtros hace ese trabajo y mejor —es exhaustivo y dice cuántos productos
  // hay en cada categoría—, así que ahí repetía cuatro nombres de más; en el
  // resto del sitio (ficha, carrito, Mi cuenta) no aporta y suma 52px de alto
  // en todas las páginas.
  const nav =
    pathname === "/" && categorias
      ? conBadgeNav(
          categorias.slice(0, MAX_CATEGORIAS_NAV).map((cat) => ({
            label: formatRubro(cat),
            href: `/catalogo?categoria=${encodeURIComponent(cat)}`,
          })),
          navBadge,
          navBadgeVisibleOn,
        )
      : [];

  // Cuál de las dos instancias del carrito está a la vista (ver compactActions).
  const [compacto, setCompacto] = useState(false);
  // Sin <Show> de Clerk: mientras cierra sesión deja la sesión "en
  // transición" (isLoaded=false) hasta terminar de navegar a la home, y <Show>
  // no renderiza ninguna de las dos ramas: el "Ingresá" desaparecía unos
  // segundos. Una vez que Clerk cargó, sin usuario confirmado ⇒ se ofrece
  // ingresar.
  //
  // Antes de que Clerk cargue, `userId` es undefined también para quien tiene
  // sesión (el ClerkProvider no trae estado inicial: el shell es estático).
  // Ahí manda lo que resolvió el servidor, y si todavía no llegó, un lugar
  // neutro: a alguien con sesión nunca se le muestra "Ingresá".
  const { isLoaded, userId } = useAuth();
  const [clerkCargo, setClerkCargo] = useState(false);
  if (isLoaded && !clerkCargo) setClerkCargo(true);
  // Mientras se hidrata (el hueco llega cuando Clerk ya pudo cargar) manda lo
  // del servidor, igual que en su HTML.
  const hidratado = useHidratado();
  const conSesion =
    hidratado && (clerkCargo || isLoaded) ? !!userId : cuenta.estado === "resuelta" ? cuenta.conSesion : null;
  const nombre = cuenta.estado === "resuelta" ? cuenta.nombre : null;

  return (
    // `site-header` en el wrapper y no en <SiteHeader>: el DS pone className
    // sólo en el <header> y la barra compacta queda afuera. La regla de
    // globals.css le saca la itálica y le da el acento a "Led" en las dos.
    <div className="site-header bg-bg">
      {/* La barra de anuncio vive en src/app/layout.tsx (global desde e88aec5,
          contenido administrable); acá solo va el header+nav globales. */}
      <SiteHeader
        brandPlacement="start"
        compactOnScroll
        onCompactChange={setCompacto}
        // El preview del carrito se abre solo al agregar: con dos instancias
        // montadas, sólo la que está a la vista debe abrirse.
        compactActions={<CartPreview autoAbrir={compacto} pathname={pathname} />}
        brandName="Central"
        brandAccent="Led"
        brandSub="Iluminación · Electricidad"
        search={<SearchAutocomplete />}
        nav={nav}
        // Marca y nav con next/link: con `<a>` cada clic recargaba la página.
        renderLink={linkNext}
        actions={
          <>
            {conSesion === null ? (
              // Identidad sin resolver: mismo lugar que "Ingresá" (el texto
              // invisible reserva el ancho), sin acción ni lectura.
              <span aria-hidden className="flex items-center gap-2 text-[13.5px] font-bold text-muted">
                <UserIcon />
                <span className="invisible">Ingresá</span>
              </span>
            ) : !conSesion ? (
              /*
                `mode="modal"` en vez de navegar a /ingresar: el cliente puede
                estar a mitad del carrito, y sacarlo de la pagina para loguearse
                es donde se pierden las compras.
              */
              <SignInButton
                mode="modal"
                fallbackRedirectUrl={destinoIngreso(pathname)}
                signUpFallbackRedirectUrl={destinoIngreso(pathname)}
              >
                <button className="flex items-center gap-2 text-[13.5px] font-bold text-text transition-colors hover:text-accent">
                  <UserIcon />
                  Ingresá
                </button>
              </SignInButton>
            ) : (
              /*
                Un solo avatar con menú propio (Mis pedidos / Mis datos /
                Seguridad / Cerrar sesión). Los datos y la seguridad siguen
                siendo el panel de Clerk: ver src/components/MenuUsuario.tsx.
              */
              <MenuUsuario nombre={nombre} />
            )}

            <CartPreview autoAbrir={!compacto} pathname={pathname} />
          </>
        }
      />
      {/* Categorías todavía en camino: se reserva el alto de la barra para que
          la home no salte cuando llegan. */}
      {pathname === "/" && categorias === null ? <div aria-hidden className={RESERVA_NAV} /> : null}
    </div>
  );
}
