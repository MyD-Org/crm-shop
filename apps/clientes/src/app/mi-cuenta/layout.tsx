import type { ReactNode } from "react";
import { MiCuentaShell } from "@/components/mi-cuenta/MiCuentaShell";
import { accesoFacturacion } from "@/lib/acceso-facturacion";
import { identidadActual } from "@/lib/auth";
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
  // Envío y facturación son consultas independientes entre sí (sólo dependen
  // de la identidad, ya resuelta): en paralelo en vez de en cascada, así el
  // nav (y con él, `mi-cuenta/loading.tsx` para el contenido) aparece antes.
  const [envio, esCuentaCorriente] = await Promise.all([envioHabilitado(), accesoFacturacion()]);
  // Sin envío a domicilio, "Direcciones y envíos" no tiene nada que ofrecer.
  const despliegue = { ...CAPACIDADES_DESPLIEGUE, direcciones: envio };
  // Con vínculo, una consulta más a la base y NINGUNA a Alegra (esto corre en
  // cada página de Mi cuenta): sólo a cuenta corriente, el contador de avisos
  // sin leer va como badge de Avisos. Si falla, el menú se arma sin badge.
  //
  // Depende de `esCuentaCorriente` (arriba), así que queda en cascada. No se
  // separó en su propio Suspense (badge del nav) porque el número ya viaja
  // horneado dentro de `entradas` (`seccionesVisibles`, tipo síncrono) y
  // `MiCuentaShell` es cliente: pasar el conteo como promesa exigiría cambiar
  // ese contrato para todas las páginas de Mi cuenta, un cambio de otra
  // tanda. Igual es una sola consulta a la base, rápida y no bloquea Alegra.
  const codigo = identidad.cliente?.codigocliente;
  let noLeidos = 0;
  if (esCuentaCorriente && despliegue.avisos && codigo) {
    try {
      noLeidos = await contarNoLeidos(codigo);
    } catch (err) {
      console.error(`mi-cuenta/layout: avisos sin leer caído (${err instanceof Error ? err.name : "desconocido"})`);
    }
  }

  return (
    <MiCuentaShell
      nombrePila={identidad.nombrePila}
      entradas={seccionesVisibles(capacidadesDe(identidad, esCuentaCorriente), despliegue, { avisos: noLeidos })}
      despliegue={despliegue}
      esCuentaCorriente={esCuentaCorriente}
      migas={migas}
    >
      {children}
    </MiCuentaShell>
  );
}
