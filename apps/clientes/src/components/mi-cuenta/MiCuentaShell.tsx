"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { Card, SectionNav, type SectionNavItem } from "@myd-org/ui";
import { linkNext } from "@/components/catalogo/link-next";
import { RUTA_PANEL_SEGURIDAD } from "@/lib/menu-usuario";
import { bajadaMiCuenta, seccionActiva, type SeccionMiCuenta } from "@/lib/mi-cuenta-nav";
import { ICONOS_SECCION } from "./iconos";

/**
 * Marco de todas las páginas de Mi cuenta: breadcrumb (slot `@migas`), el
 * único `<h1>` del módulo, la bajada y la navegación de secciones. Las
 * entradas ya vienen filtradas por identidad y despliegue desde el layout: la
 * UI no decide qué se ve, sólo cuál está activa.
 *
 * "Seguridad" y "Cerrar sesión" son acciones, no rutas: las mismas llamadas a
 * Clerk que el menú del header.
 */
export function MiCuentaShell({
  nombrePila,
  entradas,
  migas,
  children,
}: {
  nombrePila: string | null;
  entradas: SeccionMiCuenta[];
  migas: ReactNode;
  children: ReactNode;
}) {
  const clerk = useClerk();
  const activa = seccionActiva(usePathname() ?? "");

  const items: SectionNavItem[] = entradas.map((e) => ({
    id: e.id,
    label: e.label,
    href: e.href,
    icon: ICONOS_SECCION[e.id],
    tone: e.tone,
    active: !!e.href && e.id === activa,
    onSelect:
      e.id === "seguridad"
        ? () => clerk.openUserProfile({ __experimental_startPath: RUTA_PANEL_SEGURIDAD })
        : e.id === "salir"
          ? () => void clerk.signOut({ redirectUrl: "/" })
          : undefined,
  }));

  return (
    <main className="mx-auto w-full max-w-contenido flex-1 px-4 py-8">
      {migas}
      <h1 className="mt-4 font-display text-3xl font-medium tracking-tight text-text md:text-4xl">
        Hola, {nombrePila ?? "cliente"}
      </h1>
      <p className="mt-1 text-sm text-muted">{bajadaMiCuenta()}</p>
      <div className="mt-8 flex flex-col gap-6 md:flex-row">
        {/* Desde md la navegación queda a la vista al scrollear, debajo de la
            barra compacta del header (mismo top que los filtros del catálogo). */}
        <Card className="w-full min-w-0 p-2 md:sticky md:top-20 md:w-64 md:shrink-0 md:self-start">
          <SectionNav ariaLabel="Secciones de su cuenta" items={items} renderLink={linkNext} />
        </Card>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </main>
  );
}
