import { connection } from "next/server";
import { textoEnvioFicha, type ConfigEnvio } from "@/lib/envio";
import { TEXTOS_UBICACION, envioFichaSegunUbicacion } from "@/lib/ubicacion";
import { ubicacionDelVisitante } from "@/lib/ubicacion-servidor";
import { TEXTOS_ENVIO_ZONA, estimarEnvioPorLocalidad } from "@/lib/envio-zona-textos";
import { fmtPesosEnteros } from "@/lib/format";
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
 * - Con retiro elegido: la regla general (sin plazo).
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
  // Con retiro elegido la fila de envío sigue la regla general: la ubicación derivada del local no
  // es un destino de envío y el plazo (de la zona del local) tampoco aplica.
  if (resuelta.eleccion.tipo === "retiro") return <>{textoEnvioFicha(configEnvio)}</>;
  // Envío por zona (flag `envio-por-zona`; sin él `configEnvio.metodos` no existe y esto no hace nada): con la
  // localidad del visitante se anticipa la tarifa («desde $X» si la localidad toca más de una zona) y cuándo
  // llega. La geometría no sale del servidor.
  const zona = estimarEnvioPorLocalidad(configEnvio.metodos, resuelta.ubicacion, new Date());
  if (zona) {
    return (
      <>
        {zona.zonas && zona.zonas.length > 1 ? (
          <>
            <span className="font-semibold text-text">{TEXTOS_ENVIO_ZONA.enElDia}</span>
            {zona.zonas.map((z) => (
              <span key={z.nombre} className="block text-text">
                {z.nombre}: {fmtPesosEnteros(z.precio)}
              </span>
            ))}
          </>
        ) : (
          <span className="font-semibold text-text">{zona.texto}</span>
        )}
        <span className="block">
          {zona.llegada.texto}
          {zona.llegada.condicion ? `, ${zona.llegada.condicion}` : ""}.
        </span>
        {zona.avisoFeriados && <span className="block text-xs">{zona.avisoFeriados}</span>}
        {plazo && <span className={`block font-semibold ${CLASE_TONO[plazo.tono]}`}>{plazo.texto}</span>}
      </>
    );
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
