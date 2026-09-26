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
  // Sin envío a domicilio, "Direcciones y envíos" no tiene nada que ofrecer.
  const despliegue = { ...CAPACIDADES_DESPLIEGUE, direcciones: await envioHabilitado() };
  // Con vínculo, hasta dos consultas a la base y NINGUNA a Alegra (esto corre en
  // cada página de Mi cuenta): el tipo de cuenta del espejo decide todo el grupo
  // Facturación (sin fila o con el espejo caído, no se ofrece; la página decide
  // lo mismo con la misma lectura) y, sólo a cuenta corriente, el contador de
  // avisos sin leer va como badge de Avisos. Si falla, el menú se arma sin badge.
  const codigo = identidad.cliente?.codigocliente;
  const esCuentaCorriente = await accesoFacturacion();
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
