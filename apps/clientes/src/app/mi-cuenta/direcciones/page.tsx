import { redirect } from "next/navigation";
import { Alert, Card } from "@myd-org/ui";
import { BotonEnlace } from "@/components/mi-cuenta/BotonEnlace";
import { SeccionTitulo } from "@/components/mi-cuenta/SeccionTitulo";
import { identidadActual } from "@/lib/auth";
import { CIUDADES_ENVIO, ENTREGA_LABEL, MINIMO_ENVIO } from "@/lib/envio";
import { getPerfilFacturacion } from "@/lib/facturacion-db";
import { rutaIngreso } from "@/lib/ingreso";
import { textoEnvio } from "@/lib/mi-cuenta-copy";
import { RUTAS_MI_CUENTA } from "@/lib/mi-cuenta-nav";

export const dynamic = "force-dynamic";

/**
 * Direcciones y envíos (antes dos secciones: Direcciones y Envíos y retiro).
 * El domicilio de facturación, en sólo lectura y sólo con Clerk, se edita en
 * Mis datos. Las reglas de entrega (ciudades, mínimo, retiro) salen de
 * `src/lib/envio.ts`, las mismas que valida el checkout. Las direcciones de
 * entrega todavía no se guardan: se indican en cada compra (follow-up
 * `direcciones-envio`), y se dice así, sin un formulario que no persiste.
 */
export default async function DireccionesPage() {
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) redirect(rutaIngreso(RUTAS_MI_CUENTA.direcciones));

  const perfil = clerkUserId ? await getPerfilFacturacion(clerkUserId) : null;
  const lineas = perfil
    ? [
        perfil.domicilioCalle,
        [perfil.domicilioCiudad, perfil.domicilioProvincia].filter(Boolean).join(", "),
        perfil.domicilioCp ? `CP ${perfil.domicilioCp}` : null,
      ].filter((l): l is string => Boolean(l))
    : [];

  return (
    <section className="flex flex-col gap-4">
      <SeccionTitulo titulo="Direcciones y envíos" />
      {clerkUserId && (
        <Card
          title="Domicilio de facturación"
          action={
            <BotonEnlace variant="link" href={RUTAS_MI_CUENTA.datos}>
              Editar en Mis datos
            </BotonEnlace>
          }
        >
          {lineas.length > 0 ? (
            <address className="text-sm not-italic text-text">
              {lineas.map((l) => (
                <span key={l} className="block">
                  {l}
                </span>
              ))}
            </address>
          ) : (
            <p className="text-sm text-muted">Todavía no cargó su domicilio de facturación.</p>
          )}
        </Card>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card title={ENTREGA_LABEL.envio}>
          <p className="text-sm text-muted">{textoEnvio(CIUDADES_ENVIO, MINIMO_ENVIO)}</p>
        </Card>
        <Card title="Retiro en local">
          <p className="text-sm text-muted">{ENTREGA_LABEL.retiro}</p>
        </Card>
      </div>
      {/* El DS 0.13 no tiene Alert tone="info": neutral hasta que exista. */}
      <Alert tone="neutral">
        La dirección de entrega se indica en cada compra. Para otras localidades, el envío se
        coordina por separado.
      </Alert>
    </section>
  );
}
