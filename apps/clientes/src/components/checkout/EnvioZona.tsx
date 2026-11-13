"use client";

import { useMemo } from "react";
import { Button } from "@myd-org/ui";
import { fmtPrecio } from "@/lib/format";
import type { EnvioEvaluado } from "@/lib/envio";
import { TEXTOS_ENVIO_ZONA, llegadaEstimada } from "@/lib/envio-zona-textos";

/**
 * Piezas del checkout para el envío por zona (flag `envio-por-zona`). Todas dibujan sólo con datos que el
 * servidor ya resolvió (`cotizacion.envio`): la geometría de las zonas nunca llega al navegador.
 */

/** Cuándo llega, según el horario del método y el medio de pago (sin pago en línea nunca es «hoy»). */
function useLlegada(envio: EnvioEvaluado, pagaEnLinea: boolean) {
  const horario = envio.metodo?.horario;
  // Se calcula en el navegador cuando ya hay cotización (nunca en el render del servidor): sin desajuste de hidratación.
  return useMemo(
    () => (horario ? llegadaEstimada({ dias: horario.dias, horaCorte: horario.horaCorte, margenMin: horario.margenMin }, new Date(), pagaEnLinea) : null),
    [horario, pagaEnLinea],
  );
}

/** Fila «Envío» del resumen con el costo y cuándo llega. */
export function FilaEnvioResumen({ envio, pagaEnLinea }: { envio: EnvioEvaluado; pagaEnLinea: boolean }) {
  const llegada = useLlegada(envio, pagaEnLinea);
  const costo = envio.costo ?? 0;
  return (
    <div data-envio-zona="resumen">
      <div className="flex justify-between">
        <span className="text-muted">Envío{envio.metodo ? ` · ${envio.metodo.zona}` : ""}</span>
        {envio.gratis || costo === 0 ? (
          <span className="font-medium text-success">Sin cargo</span>
        ) : (
          <span className="font-medium text-text">{fmtPrecio(costo)}</span>
        )}
      </div>
      {llegada && (
        <p className="mt-0.5 text-xs text-muted">
          {llegada.texto}
          {llegada.condicion ? `, ${llegada.condicion}` : pagaEnLinea ? "" : `, ${TEXTOS_ENVIO_ZONA.pagoConfirmado}`}.
        </p>
      )}
      {envio.metodo?.avisoFeriados && <p className="mt-0.5 text-xs text-muted">{envio.metodo.avisoFeriados}</p>}
    </div>
  );
}

/**
 * Avisos del paso Entrega:
 * - la localidad la atiende un método pero falta ubicar la dirección ⇒ pedir elegir una de la lista, con la
 *   salida explícita «Continuar con envío a coordinar» (así un geocodificador caído no frena una venta);
 * - eligió coordinar ⇒ lo dice y deja volver atrás;
 * - la ubicación es aproximada (sólo la calle, sin número) ⇒ lo avisa.
 */
export function AvisoEnvioZona({
  envio,
  pagaEnLinea,
  envioACoordinar,
  onCoordinar,
  onUbicar,
}: {
  envio: EnvioEvaluado;
  pagaEnLinea: boolean;
  envioACoordinar: boolean;
  onCoordinar: () => void;
  onUbicar: () => void;
}) {
  const llegada = useLlegada(envio, pagaEnLinea);
  if (envio.sinUbicar) {
    if (envioACoordinar) {
      return (
        <div className="mt-3 rounded-lg bg-bg p-3 text-xs text-text" role="status" data-envio-zona="coordinar">
          <p>{TEXTOS_ENVIO_ZONA.aCoordinarElegido}</p>
          <Button type="button" variant="link" size="sm" onClick={onUbicar}>
            {TEXTOS_ENVIO_ZONA.volverAUbicar}
          </Button>
        </div>
      );
    }
    return (
      <div className="mt-3 rounded-lg bg-warning/10 p-3 text-xs text-text" role="alert" data-envio-zona="sin-ubicar">
        <p>{TEXTOS_ENVIO_ZONA.sinUbicar}</p>
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onCoordinar}>
          {TEXTOS_ENVIO_ZONA.continuarACoordinar}
        </Button>
      </div>
    );
  }
  if (!envio.metodo) return null;
  return (
    <div className="mt-3 rounded-lg bg-bg p-3 text-xs text-text" data-envio-zona="metodo">
      <p className="font-semibold">
        {envio.metodo.nombre}
        {envio.gratis || (envio.costo ?? 0) === 0 ? ": sin cargo" : `: ${fmtPrecio(envio.costo ?? 0)}`}
      </p>
      {llegada && (
        <p className="mt-0.5 text-muted">
          {llegada.texto}
          {llegada.condicion ? `, ${llegada.condicion}` : pagaEnLinea ? "" : `, ${TEXTOS_ENVIO_ZONA.pagoConfirmado}`}.
        </p>
      )}
      {envio.metodo.avisoFeriados && <p className="mt-0.5 text-muted">{envio.metodo.avisoFeriados}</p>}
      {envio.metodo.precision === "calle" && <p className="mt-1 text-warning">{TEXTOS_ENVIO_ZONA.direccionAproximada}</p>}
    </div>
  );
}
