import { CIUDADES_ENVIO, MINIMO_ENVIO } from "@/lib/envio";
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
 * - Con el flag `envio`: envío a domicilio. Sin él: envío a todo el país "a coordinar" (sin
 *   empresa ni costo definidos todavía). Uno u otro, nunca los dos.
 * - Retiro en el local: siempre; con `disponibilidad` (flag `disponibilidad-sucursal`) lista cada
 *   local con su dirección y su estado, si no, un texto genérico.
 */
export function EntregaProducto({
  envio,
  disponibilidad,
}: {
  envio: boolean;
  disponibilidad?: { producto: DisponibilidadVista; locales: LocalDisponibilidad[] };
}) {
  const retiro = disponibilidad?.producto.retiro;
  const locales = retiro ? (disponibilidad?.locales ?? []).filter((l) => retiro[l.slug]) : [];
  const envioDomicilio = disponibilidad?.producto.envio ? estadoEnvio(disponibilidad.producto.envio) : null;
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
      {envio ? (
        <Fila icono={<IconoEnvio />} titulo="Envío a domicilio">
          <span className="block text-muted">
            Gratis en compras desde ${MINIMO_ENVIO.toLocaleString("es-AR")} sin impuestos a {CIUDADES_ENVIO.join(" y ")}.
          </span>
          {envioDomicilio && (
            <span className={`font-semibold ${CLASE_TONO[envioDomicilio.tono]}`}>{envioDomicilio.texto}</span>
          )}
        </Fila>
      ) : (
        <Fila icono={<IconoEnvio />} titulo="Envío a todo el país">
          <span className="text-muted">Costo y plazo a coordinar con usted después de la compra.</span>
        </Fila>
      )}
    </ul>
  );
}
