import { redirect } from "next/navigation";
import { VincularClient } from "@/components/VincularClient";
import { identidadActual } from "@/lib/auth";
import { getPerfilFacturacion } from "@/lib/facturacion-db";
import { rutaIngreso } from "@/lib/ingreso";
import { RUTAS_MI_CUENTA, volverSeguro } from "@/lib/mi-cuenta-nav";

/**
 * Vincular la cuenta de cliente. Vive dentro del shell de Mi cuenta (breadcrumb
 * y título los pone el shell). Todo va dentro de una sola card, como Mis datos:
 * sin título suelto arriba. El flujo en sí es `VincularClient`.
 */
export default async function VincularPage({
  searchParams,
}: {
  searchParams: Promise<{ volver?: string | string[] }>;
}) {
  const { clerkUserId, cliente } = await identidadActual();
  // A dónde volver después de vincular (ej. el checkout). Sólo rutas internas.
  const volver = volverSeguro((await searchParams).volver);

  // Vincular exige sesión de Clerk: la vinculación se ata a una cuenta de
  // acceso concreta, y una cookie heredada del CRM no identifica ninguna.
  if (!clerkUserId) redirect(rutaIngreso(RUTAS_MI_CUENTA.vincular));

  // Ya vinculado: no hay nada que hacer acá (Mis datos muestra a qué cuenta).
  // Sigue a donde iba o al resumen, como al terminar de vincular.
  if (cliente) redirect(volver ?? RUTAS_MI_CUENTA.resumen);

  // Si su documento de facturación ya coincide con un cliente, se precarga: es
  // el que casi seguro va a escribir. Igual se valida con el código por email.
  const perfil = await getPerfilFacturacion(clerkUserId);
  const documentoSugerido = perfil?.coincideConAlegra ? (perfil.nroDoc ?? undefined) : undefined;

  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <VincularClient volver={volver} documentoSugerido={documentoSugerido} />
    </section>
  );
}
