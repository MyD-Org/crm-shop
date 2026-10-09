"use client";

import { useState, type ReactNode } from "react";
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
import { BotonAsistente } from "./chat/BotonAsistente";

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
      /** Cuenta corriente según el espejo: sólo así el menú ofrece Facturas. */
      esCuentaCorriente: boolean;
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
  /**
   * Flag `busqueda-ia`: el buscador rota ejemplos y muestra la guía al
   * enfocarlo. Lo resuelve el hueco del header; en el shell, apagado.
   */
  busquedaIa?: boolean;
  /** "Enviar a" de desktop, en las acciones a la izquierda del usuario. Lo resuelve el servidor. */
  ubicacion?: ReactNode;
  /** El mismo "Enviar a" en una línea, para mobile: debajo del buscador. */
  ubicacionEnLinea?: ReactNode;
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
  busquedaIa = false,
  ubicacion,
  ubicacionEnLinea,
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
  const esCuentaCorriente = cuenta.estado === "resuelta" && cuenta.esCuentaCorriente;

  // Cuenta: ingresar, avatar con menú o el lugar neutro mientras se resuelve. Va dos veces
  // (desktop en las acciones, mobile a la izquierda de la marca); CSS muestra una sola.
  const cuentaNodo = (alinear: "start" | "end") =>
    conSesion === null ? (
      // Identidad sin resolver: mismo lugar que "Ingresar" (el texto
      // invisible reserva el ancho), sin acción ni lectura.
      <span aria-hidden className="flex items-center gap-2 text-[13.5px] font-bold text-muted">
        <UserIcon />
        <span className="invisible max-sm:hidden">Ingresar</span>
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
          {/* En el celular, sólo el ícono: la fila es cuenta | marca | carrito. */}
          <span className="max-sm:sr-only">Ingresar</span>
        </button>
      </SignInButton>
    ) : (
      /*
        Un solo avatar con menú propio (Mis pedidos / Mis datos /
        Seguridad / Cerrar sesión). Los datos y la seguridad siguen
        siendo el panel de Clerk: ver src/components/MenuUsuario.tsx.
      */
      <MenuUsuario nombre={nombre} esCuentaCorriente={esCuentaCorriente} alinear={alinear} />
    );

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
        compactActions={<CartPreview pathname={pathname} />}
        brandName="Central"
        brandAccent="Led"
        brandSub="Iluminación · Electricidad"
        // En mobile (la búsqueda ocupa su propia fila) el "Enviar a" va en una línea debajo.
        // La barra compacta lleva sólo el buscador.
        search={
          <div className="flex w-full flex-col">
            {/* El chat se abre desde acá: el widget no tiene burbuja flotante. */}
            <div className="flex w-full items-center gap-2">
              <div className="min-w-0 flex-1">
                <SearchAutocomplete busquedaIa={busquedaIa} />
              </div>
              <BotonAsistente />
            </div>
            {ubicacionEnLinea ? <div className="mt-2.5 flex lg:hidden">{ubicacionEnLinea}</div> : null}
          </div>
        }
        compactSearch={
          // La barra compacta es angosta (200–340 px desde lg): el botón va sólo con el ícono.
          <div className="flex w-full items-center gap-2">
            <div className="min-w-0 flex-1">
              <SearchAutocomplete busquedaIa={busquedaIa} />
            </div>
            <BotonAsistente compacto />
          </div>
        }
        // Debajo de lg: cuenta a la izquierda, marca al centro y carrito a la derecha.
        mobileStart={cuentaNodo("start")}
        nav={nav}
        // Marca y nav con next/link: con `<a>` cada clic recargaba la página.
        renderLink={linkNext}
        actions={
          <>
            {/* En mobile la fila de acciones no tiene lugar: va debajo del buscador. */}
            {ubicacion ? <div className="hidden lg:flex">{ubicacion}</div> : null}
            {/* Desde lg; debajo, la cuenta va a la izquierda de la marca (mobileStart). */}
            <div className="hidden lg:flex">{cuentaNodo("end")}</div>

            <CartPreview pathname={pathname} />
          </>
        }
      />
      {/* Categorías todavía en camino: se reserva el alto de la barra para que
          la home no salte cuando llegan. */}
      {pathname === "/" && categorias === null ? <div aria-hidden className={RESERVA_NAV} /> : null}
    </div>
  );
}
