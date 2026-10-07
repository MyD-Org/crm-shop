"use client";

import { useState } from "react";
import { Button } from "@myd-org/ui";
import { fmtPrecio } from "@/lib/format";
import type { CuentaPagoSnapshot } from "@/lib/cuentas-bancarias";

/** Sin cuenta aplicable (u otro caso sin snapshot): no se inventan datos bancarios. */
export const TEXTO_SIN_CUENTA = "Le enviaremos los datos para transferir";

function BotonCopiar({ valor, etiqueta }: { valor: string; etiqueta: string }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sin permiso del portapapeles: el dato queda a la vista para copiarlo a mano.
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void copiar()} aria-label={`Copiar ${etiqueta}`}>
      {copiado ? "Copiado" : "Copiar"}
    </Button>
  );
}

/** El importe tal como se pega en el homebanking: sin "$" ni puntos de miles, con coma decimal. */
export function importeParaCopiar(importe: number): string {
  return Number.isInteger(importe) ? String(importe) : importe.toFixed(2).replace(".", ",");
}

function Fila({ nombre, valor, copiable }: { nombre: string; valor: string; copiable?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <dt className="text-muted">{nombre}</dt>
      <dd className="flex min-w-0 items-center gap-3 text-right font-semibold text-text">
        <span className="break-all">{valor}</span>
        {copiable && <BotonCopiar valor={valor} etiqueta={nombre} />}
      </dd>
    </div>
  );
}

/**
 * Datos de la cuenta para transferir: el importe destacado (para copiar tal como se pega en el
 * homebanking) y alias, CBU, banco, titular y CUIT. Se usa en "Transfiera para confirmar su pedido"
 * y en el detalle del pedido de Mi cuenta. `cuenta` es el snapshot congelado del pedido; `null` = sin
 * cuenta aplicable.
 */
export function CuentaTransferencia({
  cuenta,
  importe,
  className = "",
}: {
  cuenta: CuentaPagoSnapshot | null;
  importe?: number;
  className?: string;
}) {
  if (!cuenta) {
    return <p className={`text-sm text-muted ${className}`}>{TEXTO_SIN_CUENTA}</p>;
  }
  return (
    <div className={`flex flex-col gap-3 text-sm ${className}`}>
      {importe !== undefined && (
        <div className="flex items-center justify-between gap-3 rounded-md bg-primary-soft px-4 py-3">
          <span className="flex flex-col">
            <span className="font-semibold text-text">Importe</span>
            <span className="font-display text-2xl font-medium tracking-tight text-text">{fmtPrecio(importe)}</span>
          </span>
          <BotonCopiar valor={importeParaCopiar(importe)} etiqueta="Importe" />
        </div>
      )}
      <dl className="divide-y divide-border rounded-md border border-border px-4">
        <Fila nombre="Alias" valor={cuenta.alias} copiable />
        <Fila nombre="CBU" valor={cuenta.cbu} copiable />
        {cuenta.banco && <Fila nombre="Banco" valor={cuenta.banco} />}
        {cuenta.titular && <Fila nombre="Titular" valor={cuenta.titular} />}
        {cuenta.cuit && <Fila nombre="CUIT" valor={cuenta.cuit} />}
      </dl>
    </div>
  );
}
