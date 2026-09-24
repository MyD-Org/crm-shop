import { redirect } from "next/navigation";
import { documentoEnLinea } from "@/lib/facturacion";
import { Card } from "@myd-org/ui";
import { BotonEnlace } from "@/components/mi-cuenta/BotonEnlace";
import { VincularClient } from "@/components/VincularClient";
import { identidadActual } from "@/lib/auth";
import { getPerfilFacturacion } from "@/lib/facturacion-db";
import { rutaIngreso } from "@/lib/ingreso";
import { RUTAS_MI_CUENTA, volverSeguro } from "@/lib/mi-cuenta-nav";

export const dynamic = "force-dynamic";

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

  // Si su documento de facturación ya coincide con un cliente, se precarga: es
  // el que casi seguro va a escribir. Igual se valida con el código por email.
  const perfil = cliente ? null : await getPerfilFacturacion(clerkUserId);
  const documentoSugerido = perfil?.coincideConAlegra ? perfil.nroDoc : undefined;

  return (
    <section className="flex max-w-2xl flex-col gap-4">
      {cliente ? (
        <Card title="Su cuenta de cliente" description="Ya está vinculada.">
          <p className="text-sm text-muted">
            Su usuario está asociado a{" "}
            <span className="font-medium text-text">{cliente.razonsocial ?? cliente.codigocliente}</span>
            {cliente.cuit ? ` (${documentoEnLinea(cliente.cuit)})` : ""}. Si no corresponde, escríbanos y lo
            corregimos.
          </p>
          <div className="mt-4">
            <BotonEnlace variant="link" href={RUTAS_MI_CUENTA.resumen}>
              Volver a mi cuenta
            </BotonEnlace>
          </div>
        </Card>
      ) : (
        <VincularClient volver={volver} documentoSugerido={documentoSugerido} />
      )}
    </section>
  );
}
