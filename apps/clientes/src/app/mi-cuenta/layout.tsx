import type { ReactNode } from "react";
import { MiCuentaShell } from "@/components/mi-cuenta/MiCuentaShell";
import { identidadActual } from "@/lib/auth";
import { tipoCuentaEspejo } from "@/lib/contactos-espejo";
import { contarNoLeidos } from "@/lib/cuenta-corriente/avisos";
import { CAPACIDADES_DESPLIEGUE, capacidadesDe, seccionesVisibles } from "@/lib/mi-cuenta-nav";
import { envioHabilitado } from "@/lib/envio-flag";

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
  // Sin envío a domicilio, "Direcciones y envíos" no tiene nada que ofrecer.
  const despliegue = { ...CAPACIDADES_DESPLIEGUE, direcciones: await envioHabilitado() };
  // Con vínculo, dos consultas a la base y NINGUNA a Alegra (esto corre en cada
  // página de Mi cuenta): el tipo de cuenta del espejo decide la entrada
  // Condiciones (sin fila, no se ofrece; la página decide por su cuenta) y el
  // contador de avisos sin leer va como badge de Avisos. Si fallan, el menú se
  // arma igual, sin Condiciones y sin badge.
  const codigo = identidad.cliente?.codigocliente;
  const [tipoR, noLeidosR] = await Promise.allSettled([
    despliegue.condiciones && codigo ? tipoCuentaEspejo(codigo) : null,
    despliegue.avisos && codigo ? contarNoLeidos(codigo) : 0,
  ]);
  for (const [bloque, r] of [
    ["tipo de cuenta", tipoR],
    ["avisos sin leer", noLeidosR],
  ] as const) {
    if (r.status === "rejected") {
      console.error(`mi-cuenta/layout: ${bloque} caído (${r.reason instanceof Error ? r.reason.name : "desconocido"})`);
    }
  }
  const esCuentaCorriente = tipoR.status === "fulfilled" && tipoR.value === "corriente";
  const noLeidos = noLeidosR.status === "fulfilled" ? noLeidosR.value : 0;

  return (
    <MiCuentaShell
      nombrePila={identidad.nombrePila}
      entradas={seccionesVisibles(capacidadesDe(identidad, esCuentaCorriente), despliegue, { avisos: noLeidos })}
      despliegue={despliegue}
      migas={migas}
    >
      {children}
    </MiCuentaShell>
  );
}
