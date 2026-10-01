import { textoEnvioFicha, type ConfigEnvio } from "@/lib/envio";
import {
  estadoEnvio,
  estadoRetiroLocal,
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

const CLASE_TONO: Record<TonoDisponibilidad, string> = {
  ok: "text-success",
  demora: "text-warning",
  no: "text-danger",
};

function Fila({ icono, titulo, children }: { icono: React.ReactNode; titulo: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[20px_minmax(0,1fr)] gap-3 text-sm">
      <span className="mt-0.5 text-accent">{icono}</span>
      <div className="min-w-0">
        <span className="block font-semibold text-text">{titulo}</span>
        {children}
      </div>
    </li>
  );
}

const urlMapa = (l: LocalDisponibilidad) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([l.direccion, l.ciudad].filter(Boolean).join(", "))}`;

/**
 * Cómo se entrega, al lado del botón de compra (estilo "Retiro gratis en sucursal" de las grandes
 * tiendas, sin modal). Mismas reglas que el checkout (src/lib/envio.ts):
 * - Envío a domicilio: el texto sale de la configuración del CRM (`textoEnvioFicha`: gratis, gratis
 *   desde $X, costo a coordinar); sin fila si el envío está desactivado. `provincia`/`localidad`
 *   (la ubicación del visitante) son opcionales: sin ellas rige la regla general.
 * - Retiro en el local: siempre; con `disponibilidad` (flag `disponibilidad-sucursal`) lista cada
 *   local con su dirección y su estado, si no, un texto genérico.
 */
export function EntregaProducto({
  configEnvio,
  provincia = null,
  localidad = null,
  envioUbicacion,
  disponibilidad,
  notasLocal,
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
  /** Carrito: aclaración por local ("1 producto se trae de otra sucursal"). */
  notasLocal?: Record<string, string>;
}) {
  const retiro = disponibilidad?.producto.retiro;
  const locales = retiro ? (disponibilidad?.locales ?? []).filter((l) => retiro[l.slug]) : [];
  const envioDomicilio = disponibilidad?.producto.envio ? estadoEnvio(disponibilidad.producto.envio) : null;
  const textoEnvio = textoEnvioFicha(configEnvio, provincia, localidad);
  return (
    <ul className="space-y-4 border-t border-border pt-5">
      <Fila icono={<IconoLocal />} titulo="Retiro gratis en el local">
        {locales.length === 0 ? (
          <span className="text-muted">Sin cargo, en nuestros locales.</span>
        ) : (
          <ul className="mt-1.5 space-y-2">
            {locales.map((l) => {
              const estado = estadoRetiroLocal(retiro![l.slug]);
              return (
                <li key={l.slug}>
                  <span className="text-text">{l.nombre}</span>
                  {" · "}
                  <span className={`font-semibold ${CLASE_TONO[estado.tono]}`}>{estado.texto}</span>
                  {notasLocal?.[l.slug] && <span className="block text-muted">{notasLocal[l.slug]}</span>}
                  {l.direccion && (
                    <span className="block text-muted">
                      {[l.direccion, l.ciudad].filter(Boolean).join(", ")}
                      {" · "}
                      <a href={urlMapa(l)} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                        Ver mapa
                      </a>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Fila>
      {textoEnvio && (
        <Fila icono={<IconoEnvio />} titulo="Envío a domicilio">
          <span className="block text-muted">{envioUbicacion ?? textoEnvio}</span>
          {envioDomicilio && (
            <span className={`font-semibold ${CLASE_TONO[envioDomicilio.tono]}`}>{envioDomicilio.texto}</span>
          )}
        </Fila>
      )}
    </ul>
  );
}
