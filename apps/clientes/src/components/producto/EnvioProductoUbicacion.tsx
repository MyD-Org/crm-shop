import { connection } from "next/server";
import { textoEnvioFicha, type ConfigEnvio } from "@/lib/envio";
import { TEXTOS_UBICACION, envioFichaSegunUbicacion } from "@/lib/ubicacion";
import { ubicacionDelVisitante } from "@/lib/ubicacion-servidor";
import { SelectorUbicacion } from "@/components/ubicacion/SelectorUbicacion";
import { CLASE_TONO } from "@/components/producto/EntregaProducto";
import type { LineaDisponibilidad } from "@/lib/disponibilidad-textos";

/**
 * Texto de la fila "Envío a domicilio" de la ficha según dónde está el visitante. Componente de
 * servidor dentro de un `<Suspense>` (slot de `EntregaProducto`): lee la cookie y la dirección
 * guardada sin volver dinámica la ficha entera.
 *
 * - Sin ubicación y con envío gratis por provincias: "Ingrese su localidad" (abre el modal).
 * - Sin envío gratis o gratis en todo el país: la regla general (la ubicación no cambia nada).
 * - Con ubicación: el texto de `textoEnvioFicha` para su provincia.
 * Si la lectura falla, la regla general: la ficha no se rompe.
 */
export async function EnvioProductoUbicacion({
  configEnvio,
  plazo = null,
}: {
  configEnvio: ConfigEnvio;
  /** Plazo del envío (flag `disponibilidad-sucursal`): sólo se muestra si se sabe dónde está. */
  plazo?: LineaDisponibilidad | null;
}) {
  await connection();
  let resuelta;
  try {
    resuelta = await ubicacionDelVisitante();
  } catch (err) {
    console.error("[ficha] no se pudo leer la ubicación:", err);
    return <>{textoEnvioFicha(configEnvio)}</>;
  }
  const envio = envioFichaSegunUbicacion(configEnvio, resuelta.ubicacion);
  if (!envio) return null;
  if (envio.tipo === "texto")
    return (
      <>
        {envio.texto}
        {plazo && <span className={`block font-semibold ${CLASE_TONO[plazo.tono]}`}>{plazo.texto}</span>}
      </>
    );
  return (
    <SelectorUbicacion className="font-semibold text-accent underline underline-offset-2 hover:no-underline">
      {TEXTOS_UBICACION.pedirEnvio}
    </SelectorUbicacion>
  );
}
