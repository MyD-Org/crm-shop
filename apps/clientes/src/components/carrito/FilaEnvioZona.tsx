import { fmtPrecio } from "@/lib/format";
import { TEXTOS_ENVIO_ZONA, llegadaEstimada, type EstimadoFicha } from "@/lib/envio-zona-textos";

/**
 * Fila «Envío» del resumen del carrito con el envío por zona (flag `envio-por-zona`).
 *
 * - Con costo resuelto por el servidor (la localidad entera cae en una tarifa): el importe, que YA está
 *   sumado al total.
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
  /** Método resuelto por el servidor (zona exacta de «Usar mi ubicación»): suma «Envío en el día» y la llegada. */
  metodo?: { zona: string; horario: { dias: number[]; horaCorte: string; margenMin: number } } | null;
}) {
  if (costo !== undefined) {
    const llegada = metodo ? llegadaEstimada(metodo.horario, new Date()) : null;
    return (
      <div data-envio-zona="costo">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Envío</dt>
          <dd className="font-medium tabular-nums text-text">{gratis || costo === 0 ? "Sin cargo" : fmtPrecio(costo)}</dd>
        </div>
        {llegada && (
          <p className="mt-1 text-xs text-muted">
            {TEXTOS_ENVIO_ZONA.enElDia}. {llegada.texto}
            {llegada.condicion ? `, ${llegada.condicion}` : ""}.
          </p>
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
      <p className="mt-1 text-xs text-muted">
        {estimado.tipo === "desde"
          ? "No está incluido en el total: se calcula con su dirección al finalizar la compra. "
          : "Se confirma con su dirección al finalizar la compra. "}
        {estimado.llegada.texto}
        {estimado.llegada.condicion ? `, ${estimado.llegada.condicion}` : ""}.
        {estimado.avisoFeriados ? ` ${estimado.avisoFeriados}` : ""}
      </p>
    </div>
  );
}
