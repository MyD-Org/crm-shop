"use client";

import Link from "next/link";
import Image from "next/image";
import { SearchAutocomplete } from "./SearchAutocomplete";

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

const NAV_CATEGORIES = [
  "Iluminacion LED",
  "Lamparas y tubos",
  "Artefactos y luminarias",
  "Tableros y proteccion",
  "Cables y conductores",
  "Tomas, llaves y modulos",
  "Tiras LED y perfiles",
  "Automatizacion",
];

// Mock — reemplazar por hook de sesion real cuando haya auth
const sesion = null as { nombre: string } | null;

export function Header() {
  return (
    <header className="sticky top-0 z-50">
      {/* Announcement bar */}
      <div className="border-b border-white/5 bg-surface-dark text-sm text-white/70">
        <div className="mx-auto flex h-9 max-w-7xl items-center justify-between px-4">
          <span className="flex items-center gap-1.5">
            <MapPinIcon />
            Envios a todo el pais · Retiro en local sin cargo
          </span>
        </div>
      </div>

      {/* Main header */}
      <div className="border-b border-white/10 bg-surface-dark">
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
                <span className="text-lg font-bold tracking-tight text-white">
                  CENTRAL LED
                </span>
                <span className="block text-[10px] uppercase tracking-widest text-white/50">
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
              href={sesion ? "/portal" : "/ingresar"}
              className="flex items-center gap-2 text-sm text-white/80 transition-colors hover:text-white"
            >
              <UserIcon />
              {sesion ? sesion.nombre : "Ingresar"}
            </Link>
            <Link
              href="/carrito"
              className="flex items-center gap-2 text-sm text-white/80 transition-colors hover:text-white"
            >
              <div className="relative">
                <CartIcon />
                <span className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full bg-info text-[10px] font-bold text-white">
                  3
                </span>
              </div>
              <span className="font-semibold text-white">$24.380</span>
            </Link>
          </nav>
        </div>
      </div>

      {/* Category nav */}
      <nav className="border-b border-border bg-surface">
        <div className="no-scrollbar mx-auto flex max-w-7xl items-center gap-0 overflow-x-auto px-4">
          {NAV_CATEGORIES.map((cat) => (
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
    </header>
  );
}
