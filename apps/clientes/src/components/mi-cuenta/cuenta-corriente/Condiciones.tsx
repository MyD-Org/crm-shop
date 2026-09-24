import type { ReactNode } from "react";
import { Button, Card } from "@myd-org/ui";
import { BotonEnlace } from "@/components/mi-cuenta/BotonEnlace";
import { documentoEnLinea } from "@/lib/facturacion";
import { fmtPrecio } from "@/lib/format";
import type { CondicionesComerciales } from "@/lib/cuenta-corriente/tipos";
import {
  SIN_DATOS,
  hrefTelefono,
  limiteVisible,
  plazoAparte,
  textoConsulta,
} from "@/lib/cuenta-corriente/vista-condiciones";
import { RUTAS_MI_CUENTA } from "@/lib/mi-cuenta-nav";
import { IconoFlecha } from "../iconos";

function Fila({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-text">{children}</dd>
    </div>
  );
}

/**
 * Condiciones comerciales del cliente de cuenta corriente (CON-1), como el
 * portal (apps/admin/src/components/portal/CondicionesClient.tsx): condición de
 * pago y crédito, lista de precios y descuentos, vendedor asignado y transporte.
 * Lo que falta dice "Sin datos"; descuentos y transporte, si no hay, no se
 * muestran. Nunca datos de ejemplo.
 *
 * El límite sale del espejo; la deuda y el disponible están en Facturas y saldo
 * (se calculan con Alegra en vivo y esta página no la consulta).
 */
export function Condiciones({
  condiciones,
  razonsocial,
  cuit,
  limiteCredito,
  tenant,
}: {
  condiciones: CondicionesComerciales;
  razonsocial: string;
  cuit: string | null;
  limiteCredito: number | null;
  tenant: string | null;
}) {
  const plazo = plazoAparte(condiciones);
  const limite = limiteVisible(limiteCredito);
  const { vendedor, transporte, descuentos } = condiciones;

  return (
    <section aria-labelledby="condiciones-titulo" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 id="condiciones-titulo" className="font-display text-xl font-medium tracking-tight text-text">
          Condiciones comerciales
        </h2>
        <p className="text-sm text-muted">
          {razonsocial}
          {cuit ? ` · ${documentoEnLinea(cuit)}` : ""}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Condición de pago y crédito">
          <dl className="flex flex-col gap-3">
            <Fila label="Condición de pago">{condiciones.condicionPago ?? SIN_DATOS}</Fila>
            {plazo && <Fila label="Plazo">{plazo}</Fila>}
            {limite !== null && (
              <Fila label="Límite de crédito">
                <span className="tabular-nums">{fmtPrecio(limite)}</span>
              </Fila>
            )}
          </dl>
          {limite !== null && (
            <div className="mt-3">
              <BotonEnlace variant="link" size="inline" href={RUTAS_MI_CUENTA.facturas}>
                Ver su saldo y su crédito disponible <IconoFlecha />
              </BotonEnlace>
            </div>
          )}
        </Card>

        <Card title="Lista de precios y descuentos">
          <dl className="flex flex-col gap-3">
            <Fila label="Lista asignada">{condiciones.listaPrecios ?? SIN_DATOS}</Fila>
            {descuentos.map((d) => (
              <Fila key={d.concepto} label={d.concepto}>
                <span className="tabular-nums text-success">−{d.porcentaje}%</span>
              </Fila>
            ))}
          </dl>
        </Card>

        <Card title="Vendedor asignado">
          <dl className="flex flex-col gap-3">
            <Fila label="Nombre">{vendedor?.nombre ?? SIN_DATOS}</Fila>
            {vendedor?.telefono && (
              <Fila label="Teléfono">
                <Button variant="link" size="inline" href={hrefTelefono(vendedor.telefono)}>
                  {vendedor.telefono}
                </Button>
              </Fila>
            )}
            {vendedor?.email && (
              <Fila label="Email">
                <Button variant="link" size="inline" href={`mailto:${vendedor.email}`}>
                  {vendedor.email}
                </Button>
              </Fila>
            )}
          </dl>
        </Card>

        {transporte && (
          <Card title="Transporte y entregas">
            <dl className="flex flex-col gap-3">
              <Fila label="Modalidad">{transporte.modalidad}</Fila>
            </dl>
            {transporte.observaciones && <p className="mt-3 text-sm text-muted">{transporte.observaciones}</p>}
          </Card>
        )}
      </div>

      <p className="text-xs text-muted">
        Estas condiciones son informativas y pueden actualizarse. {textoConsulta(!!vendedor, tenant)}
      </p>
    </section>
  );
}
