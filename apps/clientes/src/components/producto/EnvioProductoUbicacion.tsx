import { connection } from "next/server";
import { textoEnvioFicha, type ConfigEnvio } from "@/lib/envio";
import { TEXTOS_UBICACION, envioFichaSegunUbicacion } from "@/lib/ubicacion";
import { ubicacionDelVisitante } from "@/lib/ubicacion-servidor";
import { ubicacionExactaVerificada } from "@/lib/ubicacion-exacta";
import { claveProvincia } from "@/lib/sucursales";
import { estimarEnvioPorLocalidad, estimarEnvioPorPunto } from "@/lib/envio-zona-textos";
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
  // Con «Usar mi ubicación» (punto firmado y vigente) la tarifa es la EXACTA de su zona; si el punto no cae en
  // ninguna, queda lo de siempre (sin «desde»: la ubicación ya es exacta). Sin punto vigente, por localidad.
  const exacta = configEnvio.metodos?.length
    ? ubicacionExactaVerificada(resuelta.eleccion, claveProvincia(resuelta.ubicacion?.provincia) || null)
    : null;
  const zona = exacta
    ? estimarEnvioPorPunto(configEnvio.metodos, exacta.destino, new Date())
    : estimarEnvioPorLocalidad(configEnvio.metodos, resuelta.ubicacion, new Date());
  if (zona) {
    return (
      <>
        {/* Como Mercado Libre: la llegada y el precio en una línea («Llega el lunes 16/11 por $ 4.490»); con
            varias zonas posibles, la llegada y debajo la tarifa de cada una. Sin el nombre del método: «en el
            día» junto a «llega el lunes» se leía como dos promesas distintas. */}
        {zona.zonas && zona.zonas.length > 1 ? (
          <>
            <span className="font-semibold text-text">{zona.llegada.texto}</span>
            {zona.zonas.map((z) => (
              <span key={z.nombre} className="block text-text">
                {z.nombre}: {fmtPesosEnteros(z.precio)}
              </span>
            ))}
          </>
        ) : (
          <span className="font-semibold text-text">
            {zona.llegada.texto} por {fmtPesosEnteros(zona.precio)}
          </span>
        )}
        {zona.llegada.condicion && (
          <span className="block">
            {zona.llegada.condicion.charAt(0).toUpperCase()}
            {zona.llegada.condicion.slice(1)}
          </span>
        )}
        {zona.avisoFeriados && <span className="block text-xs">{zona.avisoFeriados}</span>}
        {/* Sin el plazo de despacho genérico («Despacho dentro de las 24 h hábiles»): la llegada del método
            ya dice cuándo llega y las dos líneas juntas se contradicen. */}
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
