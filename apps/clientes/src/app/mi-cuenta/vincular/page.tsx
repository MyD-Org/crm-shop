import { redirect } from "next/navigation";
import { Card } from "@myd-org/ui";
import { BotonEnlace } from "@/components/mi-cuenta/BotonEnlace";
import { SeccionTitulo } from "@/components/mi-cuenta/SeccionTitulo";
import { VincularClient } from "@/components/VincularClient";
import { identidadActual } from "@/lib/auth";
import { rutaIngreso } from "@/lib/ingreso";
import { RUTAS_MI_CUENTA } from "@/lib/mi-cuenta-nav";

export const dynamic = "force-dynamic";

/**
 * Vincular la cuenta de cliente. Vive dentro del shell de Mi cuenta (breadcrumb
 * y título los pone el shell; acá el título es `<h2>`). El flujo en sí es
 * `VincularClient`, que no se toca en esta rebanada.
 */
export default async function VincularPage() {
  const { clerkUserId, cliente } = await identidadActual();

  // Vincular exige sesión de Clerk: la vinculación se ata a una cuenta de
  // acceso concreta, y una cookie heredada del CRM no identifica ninguna.
  if (!clerkUserId) redirect(rutaIngreso(RUTAS_MI_CUENTA.vincular));

  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <SeccionTitulo titulo="Vincule su cuenta de cliente" />
      <p className="text-sm text-muted">
        Si ya es cliente del local, vincule su cuenta para ver{" "}
        <span className="font-medium text-text">sus precios</span> y el estado de su cuenta
        corriente. Si no, puede seguir comprando a precio de lista sin hacer nada.
      </p>

      {cliente ? (
        <Card title="Ya está vinculado">
          <p className="text-sm text-muted">
            Su usuario está asociado a{" "}
            <span className="font-medium text-text">{cliente.razonsocial ?? cliente.codigocliente}</span>
            {cliente.cuit ? ` (CUIT ${cliente.cuit})` : ""}. Si no corresponde, escríbanos y lo
            corregimos.
          </p>
          <div className="mt-4">
            <BotonEnlace variant="link" href={RUTAS_MI_CUENTA.resumen}>
              Volver a mi cuenta
            </BotonEnlace>
          </div>
        </Card>
      ) : (
        <VincularClient />
      )}
    </section>
  );
}
