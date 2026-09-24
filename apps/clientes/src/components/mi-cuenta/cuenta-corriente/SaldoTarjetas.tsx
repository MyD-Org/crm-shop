"use client";

import { Button, KpiCard, Progress } from "@myd-org/ui";
import { fmtPrecio } from "@/lib/format";
import { porVencimiento, saldoDe } from "@/lib/cuenta-corriente/vista-facturas";
import type { Cuenta, Factura } from "@/lib/cuenta-corriente/tipos";

/**
 * Saldo arriba de la lista: Deuda total (con límite y disponible sólo si
 * `mostrarLimite`: cuenta corriente con límite cargado, lo decide el servidor
 * con `muestraLimite`), Saldo vencido y Saldo a vencer, cada
 * una con sus 2 facturas más urgentes. Todo sale de las abiertas COMPLETAS (el
 * mismo pedido que la deuda): tarjetas y contadores no se pueden contradecir.
 *
 * Tocar una factura o "Ver todas" aplica ese filtro a la lista de abajo.
 */
export function SaldoTarjetas({
  cuenta,
  mostrarLimite,
  onVerFacturas,
}: {
  cuenta: Cuenta;
  mostrarLimite: boolean;
  onVerFacturas: (estado: "vencida" | "pendiente") => void;
}) {
  const { cliente, abiertas } = cuenta;
  const vencidas = porVencimiento(abiertas, "vencida");
  const aVencer = porVencimiento(abiertas, "pendiente");
  const limite = mostrarLimite && cliente.limitecredito ? cliente.limitecredito : null;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <KpiCard label="Deuda total" value={fmtPrecio(cliente.deudatotal)} hint="Facturas pendientes de pago, vencidas y a vencer.">
        {limite !== null && (
          <div className="flex flex-col gap-2 text-xs text-muted">
            <div className="flex justify-between gap-2">
              <span>Límite de crédito</span>
              <span className="tabular-nums">{fmtPrecio(limite)}</span>
            </div>
            <Progress
              value={Math.min(cliente.deudatotal, limite)}
              max={limite}
              size="sm"
              tone={cliente.deudatotal > limite ? "danger" : "primary"}
              aria-label="Uso del límite de crédito"
            />
            <span className="tabular-nums">Disponible: {fmtPrecio(limite - cliente.deudatotal)}</span>
          </div>
        )}
      </KpiCard>

      <TarjetaSaldo
        titulo="Saldo vencido"
        monto={cliente.saldovencido}
        tono="danger"
        facturas={vencidas}
        singular="factura vencida"
        plural="facturas vencidas"
        onVer={() => onVerFacturas("vencida")}
      />
      <TarjetaSaldo
        titulo="Saldo a vencer"
        monto={cliente.saldoavencer}
        tono="warning"
        facturas={aVencer}
        singular="factura a vencer"
        plural="facturas a vencer"
        onVer={() => onVerFacturas("pendiente")}
      />
    </div>
  );
}

function TarjetaSaldo({
  titulo,
  monto,
  tono,
  facturas,
  singular,
  plural,
  onVer,
}: {
  titulo: string;
  monto: number;
  tono: "danger" | "warning";
  facturas: Factura[];
  singular: string;
  plural: string;
  onVer: () => void;
}) {
  const n = facturas.length;
  return (
    <KpiCard
      label={titulo}
      value={fmtPrecio(monto)}
      tone={monto > 0 ? tono : "neutral"}
      hint={n > 0 ? `${n} ${n === 1 ? singular : plural}` : undefined}
    >
      {n > 0 && (
        <div className="flex flex-col">
          <ul className="flex flex-col divide-y divide-border border-t border-border">
            {facturas.slice(0, 2).map((f) => (
              <li key={f.alegraId} className="flex items-center justify-between gap-2 py-1 text-xs">
                <Button variant="link" size="inline" onClick={onVer} aria-label={`Ver ${f.id} en la lista`}>
                  {f.id}
                </Button>
                <span className="font-medium tabular-nums text-text">{fmtPrecio(saldoDe(f))}</span>
              </li>
            ))}
          </ul>
          <div className="border-t border-border pt-2">
            <Button variant="link" size="inline" onClick={onVer}>
              Ver todas
            </Button>
          </div>
        </div>
      )}
    </KpiCard>
  );
}
