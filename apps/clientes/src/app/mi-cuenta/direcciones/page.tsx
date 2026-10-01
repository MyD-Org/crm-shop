import { redirect } from "next/navigation";
import { Alert, Card, EmptyState } from "@myd-org/ui";
import { BotonEnlace } from "@/components/mi-cuenta/BotonEnlace";
import { DireccionesEnvio } from "@/components/mi-cuenta/DireccionesEnvio";
import { identidadActual } from "@/lib/auth";
import { direccionDesdeFacturacion } from "@/lib/direccion-envio";
import { listarDirecciones } from "@/lib/direcciones-envio-db";
import { CONFIG_ENVIO_DEFAULT, ENTREGA_LABEL, textoRegla } from "@/lib/envio";
import { reglasVentaCacheadas } from "@/lib/sucursales-datos";
import { getPerfilFacturacion } from "@/lib/facturacion-db";
import { rutaIngreso } from "@/lib/ingreso";
import { RUTAS_MI_CUENTA } from "@/lib/mi-cuenta-nav";

/**
 * Direcciones y envíos. Con Clerk: las direcciones de envío guardadas (alta y
 * edición acá mismo, `DireccionesEnvio`), con el atajo de copiar el domicilio
 * de facturación. El domicilio fiscal en sí vive en Mis datos. Con la cookie
 * del CRM sin Clerk no hay dónde guardarlas: se invita a iniciar sesión.
 * Debajo, compactas, las reglas de entrega: el texto sale de la configuración
 * de envío del CRM (`textoRegla`), la misma que evalúa el checkout.
 */
export default async function DireccionesPage() {
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) redirect(rutaIngreso(RUTAS_MI_CUENTA.direcciones));
  // Con el envío a domicilio desactivado en el CRM la sección no figura en la
  // navegación: un link viejo o guardado vuelve a Pedidos.
  const configEnvio = (await reglasVentaCacheadas()).envio ?? CONFIG_ENVIO_DEFAULT;
  if (!configEnvio.domicilioActivo) redirect(RUTAS_MI_CUENTA.pedidos);

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
          <p className="text-sm text-muted">{textoRegla(configEnvio)}</p>
        </Card>
        <Card title="Retiro en local">
          <p className="text-sm text-muted">Retire su pedido en el local que elija.</p>
        </Card>
      </div>
      {/* El DS 0.13 no tiene Alert tone="info": neutral hasta que exista. */}
      <Alert tone="neutral">
        {clerkUserId
          ? "Al finalizar cada compra puede elegir una de sus direcciones o indicar otra."
          : "La dirección de entrega se indica en cada compra."}
      </Alert>
    </section>
  );
}
