import { CarritoClient } from "@/components/CarritoClient";
import { getOfertaCuotasSinCache } from "@/lib/cuotas-datos";
import { identidadActual } from "@/lib/auth";
import { listarDirecciones } from "@/lib/direcciones-envio-db";
import { CONFIG_ENVIO_DEFAULT } from "@/lib/envio";
import { reglasVentaCacheadas } from "@/lib/sucursales-datos";

/**
 * Provincia de la dirección predeterminada del comprador con sesión (única ubicación conocida
 * por ahora). Sin sesión, sin direcciones o si la lectura falla: null (la barra de envío gratis
 * no aparece si el alcance depende de la provincia).
 */
async function provinciaConocida(clerkUserId: string | null | undefined): Promise<string | null> {
  if (!clerkUserId) return null;
  try {
    const direcciones = await listarDirecciones(clerkUserId);
    return (direcciones.find((d) => d.predeterminada) ?? direcciones[0])?.provincia ?? null;
  } catch (err) {
    console.error("[carrito] no se pudieron leer las direcciones guardadas:", err);
    return null;
  }
}

export default async function CarritoPage() {
  const [oferta, { clerkUserId, cliente }, reglas] = await Promise.all([
    getOfertaCuotasSinCache(),
    identidadActual(),
    reglasVentaCacheadas(),
  ]);
  return (
    <CarritoClient
      oferta={oferta}
      conSesion={!!(clerkUserId || cliente)}
      configEnvio={reglas.envio ?? CONFIG_ENVIO_DEFAULT}
      provincia={await provinciaConocida(clerkUserId)}
    />
  );
}
