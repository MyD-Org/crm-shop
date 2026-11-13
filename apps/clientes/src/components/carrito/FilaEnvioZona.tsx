import { fmtPrecio } from "@/lib/format";
import { llegadaEstimada, textoLineaLlegada, type EstimadoFicha } from "@/lib/envio-zona-textos";
import { CartelEnvioRapido } from "@/components/envio/CartelEnvioRapido";

/**
 * Fila «Envío» del resumen del carrito con el envío por zona (flag `envio-por-zona`).
 *
 * - Con costo resuelto por el servidor (la localidad entera cae en una tarifa): el importe, que YA está
 *   sumado al total, con el cartel del método y «Llega … por $X».
 * - Con un estimado «desde $X»: se muestra como orientación y NO suma al total; el costo exacto se calcula
 *   en el checkout con la dirección.
 * - Sin ninguno de los dos no dibuja nada: el resumen queda como siempre.
 */
export function FilaEnvioZona({
  costo,
  gratis,
  estimado,
  metodo,
}: {
  costo: number | undefined;
  gratis: boolean;
  estimado: EstimadoFicha | undefined;
  /** Método resuelto por el servidor (zona exacta de «Usar mi ubicación»): cartel con su nombre y la llegada. */
  metodo?: {
    nombre?: string;
    zona: string;
    horario: { dias: number[]; horaCorte: string; margenMin: number };
    horarioEntrega?: string;
  } | null;
}) {
  if (costo !== undefined) {
    const llegada = metodo ? llegadaEstimada(metodo.horario, new Date(), true, metodo.horarioEntrega) : null;
    const sinCargo = gratis || costo === 0;
    return (
      <div data-envio-zona="costo">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Envío</dt>
          <dd className="font-medium tabular-nums text-text">{sinCargo ? "Sin cargo" : fmtPrecio(costo)}</dd>
        </div>
        {llegada && (
          <div className="mt-1 text-xs text-muted">
            {metodo?.nombre && (
              <div className="mb-1">
                <CartelEnvioRapido nombre={metodo.nombre} />
              </div>
            )}
            <p>{textoLineaLlegada(llegada.texto, undefined, sinCargo ? undefined : costo)}</p>
            {llegada.condicion && <p className="text-success">{llegada.condicion}</p>}
          </div>
        )}
      </div>
    );
  }
  if (!estimado) return null;
  return (
    <div data-envio-zona="estimado">
      <div className="flex justify-between gap-3">
        <dt className="text-muted">Envío</dt>
        <dd className="font-medium tabular-nums text-text">
          {estimado.tipo === "desde" ? "desde " : ""}
          {fmtPrecio(estimado.precio)}
        </dd>
      </div>
      <div className="mt-1 text-xs text-muted">
        <div className="mb-1">
          <CartelEnvioRapido nombre={estimado.metodo} />
        </div>
        <p>{estimado.texto}</p>
        {estimado.llegada.condicion && <p className="text-success">{estimado.llegada.condicion}</p>}
        <p>
          {estimado.tipo === "desde"
            ? "No está incluido en el total: se calcula con su dirección al finalizar la compra."
            : "Se confirma con su dirección al finalizar la compra."}
        </p>
        {estimado.avisoFeriados && <p>{estimado.avisoFeriados}</p>}
      </div>
    </div>
  );
}
