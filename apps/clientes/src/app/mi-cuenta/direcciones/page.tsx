import { redirect } from "next/navigation";
import { Card, EmptyState } from "@myd-org/ui";
import { BotonEnlace } from "@/components/mi-cuenta/BotonEnlace";
import { SeccionTitulo } from "@/components/mi-cuenta/SeccionTitulo";
import { identidadActual } from "@/lib/auth";
import { getPerfilFacturacion } from "@/lib/facturacion-db";
import { rutaIngreso } from "@/lib/ingreso";
import { RUTAS_MI_CUENTA } from "@/lib/mi-cuenta-nav";

export const dynamic = "force-dynamic";

/**
 * Direcciones, en sólo lectura. El domicilio de facturación se edita en Mis
 * datos; las direcciones de entrega todavía no se guardan (se indican en cada
 * compra, follow-up `direcciones-envio`): se dice así, sin un formulario que
 * no persiste.
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
      <SeccionTitulo titulo="Direcciones" />
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
      <EmptyState
        title="La dirección de entrega se indica en cada compra."
        description="Pronto podrá guardar direcciones predeterminadas."
      />
    </section>
  );
}
