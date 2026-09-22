import type { ReactNode } from "react";
import { MiCuentaShell } from "@/components/mi-cuenta/MiCuentaShell";
import { identidadActual } from "@/lib/auth";
import { capacidadesDe, seccionesVisibles } from "@/lib/mi-cuenta-nav";

/**
 * Shell de Mi cuenta: saludo, breadcrumb (slot `@migas`) y navegación por
 * sección, compartido por todas las páginas. No se vuelve a renderizar al
 * navegar entre secciones hermanas.
 *
 * La autenticación la decide cada página y no este layout: el layout no
 * conoce la ruta exacta, y el ingreso tiene que volver a ella (un enlace a un
 * pedido puntual no puede terminar en el resumen). Sin identidad devuelve la
 * página sola, que redirige. `identidadActual` está en `cache()`: layout y
 * página comparten una sola resolución por request.
 */
export default async function MiCuentaLayout({
  children,
  migas,
}: {
  children: ReactNode;
  migas: ReactNode;
}) {
  const identidad = await identidadActual();
  if (!identidad.clerkUserId && !identidad.cliente) return <>{children}</>;

  return (
    <MiCuentaShell
      nombrePila={identidad.nombrePila}
      entradas={seccionesVisibles(capacidadesDe(identidad))}
      migas={migas}
    >
      {children}
    </MiCuentaShell>
  );
}
