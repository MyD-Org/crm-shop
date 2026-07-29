"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { SearchAutocomplete } from "./SearchAutocomplete";
import { CartPreview } from "./CartPreview";

function UserIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}

function MapPinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

export function HeaderUI({
  sesion,
  categorias,
}: {
  sesion: { nombre: string } | null;
  /** Categorias reales del catalogo, resueltas en HeaderServer. */
  categorias: string[];
}) {
  const pathname = usePathname();
  // En "Mi cuenta" ocultamos la barra de categorias para que se sienta una
  // seccion propia y no de tienda.
  const hideCategorias = pathname?.startsWith("/mi-cuenta");

  return (
    <header className="sticky top-0 z-50">

      {/* Main header */}
      <div className="border-b border-border bg-surface">
        <div className="mx-auto flex h-[72px] max-w-7xl items-center gap-8 px-4">
          {/* Logo */}
          <Link href="/" className="shrink-0">
            <div className="flex items-center gap-3">
              <Image
                src="/central-led-avatar.jpg"
                alt="Central LED"
                width={44}
                height={44}
                className="rounded-full"
              />
              <div className="leading-tight">
                <span className="text-lg font-bold tracking-tight text-text">
                  CENTRAL LED
                </span>
                <span className="block text-[10px] uppercase tracking-widest text-muted">
                  Iluminacion · Electricidad
                </span>
              </div>
            </div>
          </Link>

          {/* Search */}
          <div className="flex flex-1 items-center">
            <SearchAutocomplete />
          </div>

          {/* Actions */}
          <nav className="flex items-center gap-5">
            <Link
              href={sesion ? "/mi-cuenta" : "/ingresar"}
              className="flex items-center gap-2 text-sm text-muted transition-colors hover:text-text"
            >
              <UserIcon />
              {sesion ? sesion.nombre : "Ingresar"}
            </Link>
            <CartPreview />
          </nav>
        </div>
      </div>

      {/* Category nav */}
      {!hideCategorias && categorias.length > 0 && (
      <nav className="border-b border-border bg-elevated">
        <div className="no-scrollbar mx-auto flex max-w-7xl items-center gap-0 overflow-x-auto px-4">
          {categorias.map((cat) => (
            <Link
              key={cat}
              href={`/catalogo?categoria=${encodeURIComponent(cat)}`}
              className="shrink-0 px-4 py-3 text-sm text-[#454b54] transition-colors hover:bg-elevated hover:text-text"
            >
              {cat}
            </Link>
          ))}
        </div>
      </nav>
      )}
    </header>
  );
}
