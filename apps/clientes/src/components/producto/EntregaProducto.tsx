import { Divider } from "@myd-org/ui";
import { textoEnvioFicha, type ConfigEnvio } from "@/lib/envio";
import { TEXTOS_UBICACION } from "@/lib/ubicacion";
import { tieneHorario } from "@/lib/horario-agrupado";
import { disponibleAntesEn, localPrincipalDeRetiro, retiroDeFicha } from "@/lib/entrega-eleccion";
import { SelectorUbicacion } from "@/components/ubicacion/SelectorUbicacion";
import { VerLocal } from "@/components/producto/VerLocal";
import { CambiarRetiro, OtrosLocales } from "@/components/producto/EntregaAcciones";
import {
  estadoEnvio,
  estadoRetiroLocal,
  type EstadoProductoLocal,
  type DisponibilidadVista,
  type LocalDisponibilidad,
  type TonoDisponibilidad,
} from "@/lib/disponibilidad-textos";

function IconoEnvio() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  );
}

function IconoLocal() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 9l1-5h16l1 5M3 9h18v11H3zM9 20v-6h6v6" />
    </svg>
  );
}

export const CLASE_TONO: Record<TonoDisponibilidad, string> = {
  ok: "text-success",
  demora: "text-warning",
  no: "text-danger",
};

/** `secundaria`: la opción que no eligió el visitante (ícono y título atenuados). */
function Fila({
  icono,
  titulo,
  accion,
  secundaria = false,
  children,
}: {
  icono: React.ReactNode;
  titulo: string;
  /** A la derecha del título (ej. "Ver local"). */
  accion?: React.ReactNode;
  secundaria?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <li className="grid grid-cols-[20px_minmax(0,1fr)] gap-3 text-sm">
      <span className={`mt-0.5 ${secundaria ? "text-muted" : "text-accent"}`}>{icono}</span>
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <span className={secundaria ? "block font-medium text-muted" : "block font-semibold text-text"}>{titulo}</span>
          {accion}
        </div>
        {children}
      </div>
    </li>
  );
}

function Separador() {
  return (
    <li role="presentation">
      <Divider />
    </li>
  );
}

const hayDatosDeLocal = (l: LocalDisponibilidad) => Boolean(l.direccion) || tieneHorario(l);

/**
 * Cómo se entrega, al lado del botón de compra (estilo "Retiro gratis en sucursal" de las grandes
 * tiendas, sin modal). Mismas reglas que el checkout (src/lib/envio.ts):
 * - Envío a domicilio: el texto sale de la configuración del CRM (`textoEnvioFicha`: gratis, gratis
 *   desde $X, costo a coordinar); sin fila si el envío está desactivado. `provincia`/`localidad`
 *   (la ubicación del visitante) son opcionales: sin ellas rige la regla general.
 * - Retiro en el local: siempre; con `disponibilidad` (flag `disponibilidad-sucursal`) lista cada
 *   local con su dirección y su estado, si no, un texto genérico.
 *
 * Con una elección de "Enviar a" (sólo en la ficha), lo elegido va primero y la otra opción queda
 * debajo, atenuada:
 * - Retiro: "Retiro gratis en {local}" con su estado y, si otro local lo tiene antes, "Cambiar".
 * - Envío: "Envío a {destino}" con su costo y despacho, y el local de retiro que mejor sirve.
 */
export function EntregaProducto({
  configEnvio,
  provincia = null,
  localidad = null,
  envioUbicacion,
  disponibilidad,
  detallePorLocal,
  ubicacionConocida = true,
  localElegido = null,
  envioElegido = null,
}: {
  configEnvio: ConfigEnvio;
  provincia?: string | null;
  localidad?: string | null;
  /**
   * Texto del envío según la ubicación del visitante, resuelto en un componente de servidor dentro
   * de un `<Suspense>` (la cookie no se puede leer acá sin volver dinámica toda la ficha). Sin él,
   * se usa `provincia`/`localidad` o la regla general.
   */
  envioUbicacion?: React.ReactNode;
  disponibilidad?: { producto: DisponibilidadVista; locales: LocalDisponibilidad[] };
  /** Carrito: estado de cada producto del pedido por local (popup "Ver local"). */
  detallePorLocal?: Record<string, EstadoProductoLocal[]>;
  /** Carrito: sin ubicación no se muestra plazo; se pide la localidad. (La ficha lo resuelve en el slot.) */
  ubicacionConocida?: boolean;
  /** Local de retiro elegido en "Enviar a" (slug). Se muestra primero, con su estado, aunque no tenga stock. */
  localElegido?: string | null;
  /** Destino del envío elegido en "Enviar a" ("Calle 123" o la localidad). Se muestra primero. */
  envioElegido?: string | null;
}) {
  const retiro = disponibilidad?.producto.retiro;
  // Primero el local elegido y, después, el que mejor sirve: lo primero que se lee es lo que importa.
  const { elegido, otros } = retiro
    ? retiroDeFicha(disponibilidad?.locales ?? [], retiro, localElegido)
    : { elegido: null, otros: [] };
  const locales = elegido ? [elegido, ...otros] : otros;
  const envioDomicilio = disponibilidad?.producto.envio ? estadoEnvio(disponibilidad.producto.envio) : null;
  const textoEnvio = textoEnvioFicha(configEnvio, provincia, localidad);
  const enFicha = !detallePorLocal;

  const estadoDe = (l: LocalDisponibilidad) => estadoRetiroLocal(retiro![l.slug]);
  const verLocal = (l: LocalDisponibilidad) =>
    hayDatosDeLocal(l) ? <VerLocal local={l} productos={detallePorLocal?.[l.slug]} /> : null;

  // Retiro elegido: el local primero y el envío a domicilio como alternativa atenuada.
  if (enFicha && elegido && retiro) {
    const estado = estadoDe(elegido);
    const antes = disponibleAntesEn(elegido, otros, retiro);
    return (
      <ul className="space-y-4 border-t border-border pt-5" data-entrega="retiro">
        <Fila icono={<IconoLocal />} titulo={TEXTOS_UBICACION.retiroGratisEn(elegido.nombre)} accion={verLocal(elegido)}>
          <span className={`block font-semibold ${CLASE_TONO[estado.tono]}`} data-local-elegido>
            {estado.tono === "no" ? TEXTOS_UBICACION.sinStockEn(elegido.nombre) : estado.texto}
          </span>
          {antes && (
            <span className="mt-1 block text-xs text-muted">
              {TEXTOS_UBICACION.disponibleEn(antes.texto, antes.local.nombre)} · <CambiarRetiro sucursal={antes.local.slug} />
            </span>
          )}
        </Fila>
        {textoEnvio && (
          <>
            <Separador />
            <Fila icono={<IconoEnvio />} titulo={TEXTOS_UBICACION.tambienEnvio} secundaria>
              {envioDomicilio && <span className="block text-muted">{envioDomicilio.texto}</span>}
            </Fila>
          </>
        )}
      </ul>
    );
  }

  // Envío elegido: el envío primero y el local que mejor sirve como alternativa atenuada.
  if (enFicha && envioElegido && textoEnvio && retiro && locales.length > 0) {
    const { principal, resto } = localPrincipalDeRetiro(disponibilidad?.locales ?? [], retiro);
    const linea = (l: LocalDisponibilidad) => {
      const estado = estadoDe(l);
      return (
        <div className="flex items-baseline justify-between gap-3">
          <span>
            <span className="text-text">{l.nombre}</span>
            {" · "}
            <span className={`font-semibold ${CLASE_TONO[estado.tono]}`}>{estado.texto}</span>
          </span>
          {verLocal(l)}
        </div>
      );
    };
    return (
      <ul className="space-y-4 border-t border-border pt-5" data-entrega="envio">
        <Fila icono={<IconoEnvio />} titulo={TEXTOS_UBICACION.envioA(envioElegido)}>
          {envioUbicacion ? (
            <span className="block text-muted">{envioUbicacion}</span>
          ) : (
            <>
              <span className="block text-muted">{textoEnvio}</span>
              {envioDomicilio && (
                <span className={`font-semibold ${CLASE_TONO[envioDomicilio.tono]}`}>{envioDomicilio.texto}</span>
              )}
            </>
          )}
        </Fila>
        <Separador />
        <Fila icono={<IconoLocal />} titulo={TEXTOS_UBICACION.oRetirelo} secundaria>
          <div className="mt-1.5">{principal && linea(principal)}</div>
          {resto.length > 0 && (
            <OtrosLocales>
              <div className="mt-1.5 space-y-1.5">
                {resto.map((l) => (
                  <div key={l.slug}>{linea(l)}</div>
                ))}
              </div>
            </OtrosLocales>
          )}
        </Fila>
      </ul>
    );
  }

  // Sin elección (y carrito): ambos locales con su estado y el envío a domicilio.
  return (
    <ul className="space-y-4 border-t border-border pt-5">
      <Fila icono={<IconoLocal />} titulo="Retiro gratis en el local">
        {locales.length === 0 ? (
          <span className="text-muted">Sin cargo, en nuestros locales.</span>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {locales.map((l) => {
              const estado = estadoDe(l);
              // En el carrito, "No disponible" es para el pedido completo, no para el local.
              const texto = detallePorLocal && estado.tono === "no" ? "No disponible para este pedido" : estado.texto;
              return (
                <li key={l.slug} className="flex items-baseline justify-between gap-3">
                  <span>
                    <span className="text-text">{l.nombre}</span>
                    {" · "}
                    <span className={`font-semibold ${CLASE_TONO[estado.tono]}`}>{texto}</span>
                  </span>
                  {verLocal(l)}
                </li>
              );
            })}
          </ul>
        )}
      </Fila>
      {textoEnvio && (
        <Fila icono={<IconoEnvio />} titulo="Envío a domicilio">
          {envioUbicacion ? (
            // El slot de la ficha decide texto y plazo según la ubicación.
            <span className="block text-muted">{envioUbicacion}</span>
          ) : !ubicacionConocida ? (
            <SelectorUbicacion className="font-semibold text-accent underline underline-offset-2 hover:no-underline">
              {TEXTOS_UBICACION.pedirEnvio}
            </SelectorUbicacion>
          ) : (
            <>
              <span className="block text-muted">{textoEnvio}</span>
              {envioDomicilio && (
                <span className={`font-semibold ${CLASE_TONO[envioDomicilio.tono]}`}>{envioDomicilio.texto}</span>
              )}
            </>
          )}
        </Fila>
      )}
    </ul>
  );
}
