"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { SiteHeader, type VisibleOn } from "@myd-org/ui";
import type { NavBadgeContent } from "@/data/home-defaults";
import { SearchAutocomplete } from "./SearchAutocomplete";
import { destinoSeguro } from "@/lib/ingreso";
import { busquedaAplicada } from "@/lib/busqueda-header";
import { useHidratado } from "@/lib/hidratado";
import { MAX_CATEGORIAS_NAV, conBadgeNav } from "@/lib/nav-badge";
import { formatRubro } from "@/lib/formato-rubro";
import { CartPreview } from "./CartPreview";
import { linkNext } from "./catalogo/link-next";
import { MenuUsuario } from "./MenuUsuario";
import { BotonAsistente } from "./chat/BotonAsistente";
import { IconoWhatsapp } from "./IconoWhatsapp";
import logo from "@/assets/central-led-logo.svg";
import { MARCA_POR_DEFECTO, altLogo, partesNombre } from "@/lib/marca-base";
import { useMarca } from "./MarcaProvider";

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
  /** `https://wa.me/…` del WhatsApp del footer; null = sin número cargado, sin botón. */
  whatsapp?: string | null;
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

/**
 * Lleva el texto de los buscadores a la búsqueda aplicada cada vez que cambia la URL (ver
 * `busquedaAplicada`): lo tipeado y no enviado se descarta al navegar. Aparte y en su propio
 * Suspense, porque `useSearchParams` suspende en el prerender y el header no espera por esto.
 */
function SincronizarBusqueda({ setBusqueda }: { setBusqueda: (texto: string) => void }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const url = `${pathname}?${params.toString()}`;
  const texto = busquedaAplicada(pathname, params);
  // Por la URL y no por el texto: de una página sin búsqueda a otra el texto aplicado no cambia,
  // pero lo que se haya tipeado en el medio tiene que irse igual.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setBusqueda(texto), [url, setBusqueda]);
  return null;
}

/**
 * WhatsApp de la tienda, a mano en todas las páginas: en las acciones del header (desde lg, con
 * texto), junto a la cuenta en el celular y en la barra compacta. Verde de WhatsApp oscurecido
 * para llegar a 3:1 sobre el fondo claro.
 */
function BotonWhatsapp({ href, conTexto = false }: { href: string; conTexto?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={conTexto ? undefined : "Consultar por WhatsApp"}
      className="flex shrink-0 items-center gap-2 text-[13.5px] font-bold text-text transition-colors hover:text-accent"
    >
      <IconoWhatsapp className="size-[22px] text-[#1DAA61]" />
      {conTexto ? <span>WhatsApp</span> : null}
    </a>
  );
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
  whatsapp = null,
  pathname,
}: PropsHeader & { pathname: string | null }) {
  // Marca de la tienda: nombre en una o dos tintas, línea de abajo y logo. Central usa el SVG de
  // código (letras en trazos); una marca con logo propio, el suyo; sin ninguno de los dos, el
  // nombre en texto.
  const marca = useMarca();
  const { principal, acento } = partesNombre(marca);
  const logoMarca = (className: string, prioridad: boolean) =>
    marca.logoUrl ? (
      // `unoptimized`: un SVG remoto no pasa por el optimizador y el logo ya viene dimensionado.
      <Image src={marca.logoUrl} alt={altLogo(marca)} width={160} height={32} unoptimized priority={prioridad} className={className} />
    ) : marca.nombre === MARCA_POR_DEFECTO.nombre ? (
      <Image src={logo} alt={altLogo(marca)} priority={prioridad} className={className} />
    ) : undefined;

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

  // Un solo texto para los dos buscadores (el del header y el de la barra
  // compacta): si no, al scrollear se veía lo último tipeado en uno y en el
  // otro, una búsqueda vieja.
  const [busqueda, setBusqueda] = useState("");
  const buscador = (
    <SearchAutocomplete busquedaIa={busquedaIa} extra={<BotonAsistente />} query={busqueda} setQuery={setBusqueda} />
  );

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
        compactActions={
          <div className="flex items-center gap-3">
            {whatsapp ? <BotonWhatsapp href={whatsapp} /> : null}
            <CartPreview pathname={pathname} />
          </div>
        }
        brandName={principal}
        brandAccent={acento}
        brandSub={marca.lema}
        // Logo en SVG (letras en trazos, no depende de ninguna fuente): el
        // mismo archivo en las tres barras. La compacta sólo se ve desde lg.
        brandLogo={logoMarca("h-6 w-auto lg:h-8", true)}
        compactBrandLogo={logoMarca("h-[26px] w-auto", false)}
        // En mobile (la búsqueda ocupa su propia fila) el "Enviar a" va en una línea debajo.
        // La barra compacta lleva sólo el buscador.
        search={
          <div className="flex w-full flex-col">
            {/* El chat se abre desde el buscador: el widget no tiene burbuja flotante. */}
            {buscador}
            {ubicacionEnLinea ? <div className="mt-2.5 flex lg:hidden">{ubicacionEnLinea}</div> : null}
          </div>
        }
        compactSearch={buscador}
        // Debajo de lg: cuenta a la izquierda, marca al centro y carrito a la derecha.
        // El WhatsApp va con la cuenta y no con el carrito: así la marca sigue centrada.
        mobileStart={
          <div className="flex items-center gap-4">
            {cuentaNodo("start")}
            {whatsapp ? <BotonWhatsapp href={whatsapp} /> : null}
          </div>
        }
        nav={nav}
        // Marca y nav con next/link: con `<a>` cada clic recargaba la página.
        renderLink={linkNext}
        actions={
          <>
            {/* En mobile la fila de acciones no tiene lugar: va debajo del buscador. */}
            {ubicacion ? <div className="hidden lg:flex">{ubicacion}</div> : null}
            {/* Desde lg; debajo, la cuenta va a la izquierda de la marca (mobileStart). */}
            <div className="hidden lg:flex">{cuentaNodo("end")}</div>
            {whatsapp ? (
              <div className="hidden lg:flex">
                <BotonWhatsapp href={whatsapp} conTexto />
              </div>
            ) : null}

            <CartPreview pathname={pathname} />
          </>
        }
      />
      {/* Categorías todavía en camino: se reserva el alto de la barra para que
          la home no salte cuando llegan. */}
      {pathname === "/" && categorias === null ? <div aria-hidden className={RESERVA_NAV} /> : null}
      <Suspense fallback={null}>
        <SincronizarBusqueda setBusqueda={setBusqueda} />
      </Suspense>
    </div>
  );
}
