import { trackingActivo } from "@/lib/tracking-flag";
import { TrackingCliente } from "./TrackingCliente";

/**
 * Hueco del layout (server, dentro de `<Suspense fallback={null}>`): el flag
 * `tracking` se evalúa por request, fuera del shell estático. Apagado es null y
 * no se carga ningún script. Detrás de la cortina tampoco aparece: el proxy
 * responde el gate antes de llegar al layout.
 */
export async function TrackingServidor() {
  const config = await trackingActivo();
  return config ? <TrackingCliente config={config} /> : null;
}
