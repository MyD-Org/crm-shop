import { redirect } from "next/navigation";
import { Alert, Card, EmptyState } from "@myd-org/ui";
import { BotonEnlace } from "@/components/mi-cuenta/BotonEnlace";
import { DireccionesEnvio } from "@/components/mi-cuenta/DireccionesEnvio";
import { identidadActual } from "@/lib/auth";
import { direccionDesdeFacturacion } from "@/lib/direccion-envio";
import { listarDirecciones } from "@/lib/direcciones-envio-db";
import { CIUDADES_ENVIO, ENTREGA_LABEL, MINIMO_ENVIO } from "@/lib/envio";
import { envioHabilitado } from "@/lib/envio-flag";
import { getPerfilFacturacion } from "@/lib/facturacion-db";
import { rutaIngreso } from "@/lib/ingreso";
import { textoEnvio } from "@/lib/mi-cuenta-copy";
import { RUTAS_MI_CUENTA } from "@/lib/mi-cuenta-nav";

/**
 * Direcciones y envíos. Con Clerk: las direcciones de envío guardadas (alta y
 * edición acá mismo, `DireccionesEnvio`), con el atajo de copiar el domicilio
 * de facturación. El domicilio fiscal en sí vive en Mis datos. Con la cookie
 * del CRM sin Clerk no hay dónde guardarlas: se invita a iniciar sesión.
 * Debajo, compactas, las reglas de entrega de `src/lib/envio.ts` (las mismas
 * que valida el checkout).
 */
export default async function DireccionesPage() {
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) redirect(rutaIngreso(RUTAS_MI_CUENTA.direcciones));
  // Con el flag `envio` apagado la sección no figura en la navegación: un link
  // viejo o guardado vuelve a Pedidos.
  if (!(await envioHabilitado())) redirect(RUTAS_MI_CUENTA.pedidos);

  const [direcciones, perfil] = clerkUserId
    ? await Promise.all([listarDirecciones(clerkUserId), getPerfilFacturacion(clerkUserId)])
    : [[], null];

  return (
    <section className="flex flex-col gap-4">
      {clerkUserId ? (
        <DireccionesEnvio
          iniciales={direcciones}
          facturacion={direccionDesdeFacturacion(perfil)}
        />
      ) : (
        <EmptyState
          title="Inicie sesión con su usuario para guardar direcciones de envío."
          action={
            <BotonEnlace href={rutaIngreso(RUTAS_MI_CUENTA.direcciones)}>Iniciar sesión</BotonEnlace>
          }
        />
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
        {clerkUserId
          ? "Al finalizar cada compra puede elegir una de sus direcciones o indicar otra. Para otras localidades, el envío se coordina por separado."
          : "La dirección de entrega se indica en cada compra. Para otras localidades, el envío se coordina por separado."}
      </Alert>
    </section>
  );
}
