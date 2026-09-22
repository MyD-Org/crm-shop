import { redirect } from "next/navigation";
import { Alert, Card } from "@myd-org/ui";
import { SeccionTitulo } from "@/components/mi-cuenta/SeccionTitulo";
import { identidadActual } from "@/lib/auth";
import { CIUDADES_ENVIO, ENTREGA_LABEL, MINIMO_ENVIO } from "@/lib/envio";
import { rutaIngreso } from "@/lib/ingreso";
import { textoEnvio } from "@/lib/mi-cuenta-copy";
import { RUTAS_MI_CUENTA } from "@/lib/mi-cuenta-nav";

export const dynamic = "force-dynamic";

/**
 * Envíos y retiro: informativa. Ciudades, mínimo y etiquetas salen de
 * `src/lib/envio.ts` (las mismas reglas que valida el checkout): si cambia la
 * regla, cambia esta página sin tocarla.
 */
export default async function EnviosPage() {
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) redirect(rutaIngreso(RUTAS_MI_CUENTA.envios));

  return (
    <section className="flex flex-col gap-4">
      <SeccionTitulo titulo="Envíos y retiro" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Card title={ENTREGA_LABEL.envio}>
          <p className="text-sm text-muted">{textoEnvio(CIUDADES_ENVIO, MINIMO_ENVIO)}</p>
        </Card>
        <Card title="Retiro en local">
          <p className="text-sm text-muted">{ENTREGA_LABEL.retiro}</p>
        </Card>
      </div>
      {/* El DS 0.13 no tiene Alert tone="info": neutral hasta que exista. */}
      <Alert tone="neutral">Para otras localidades, el envío se coordina por separado.</Alert>
    </section>
  );
}
