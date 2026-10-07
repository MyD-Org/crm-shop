"use client";

import { useState } from "react";
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
    <button
      type="button"
      onClick={() => void copiar()}
      aria-label={`Copiar ${etiqueta}`}
      className="shrink-0 text-xs font-semibold text-primary hover:underline"
    >
      {copiado ? "Copiado" : "Copiar"}
    </button>
  );
}

/** El importe tal como se pega en el homebanking: sin "$" ni puntos de miles, con coma decimal. */
export function importeParaCopiar(importe: number): string {
  return Number.isInteger(importe) ? String(importe) : importe.toFixed(2).replace(".", ",");
}

function Fila({
  nombre,
  valor,
  copiable,
  copiar,
  destacada,
}: {
  nombre: string;
  valor: string;
  copiable?: boolean;
  /** Lo que se copia, si no es el valor que se ve. */
  copiar?: string;
  destacada?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${destacada ? "py-2.5" : "py-1.5"}`}>
      <dt className={destacada ? "font-semibold text-text" : "text-muted"}>{nombre}</dt>
      <dd className={`flex items-baseline gap-3 text-right font-semibold text-text ${destacada ? "text-lg" : ""}`}>
        <span className="break-all">{valor}</span>
        {(copiable || copiar !== undefined) && <BotonCopiar valor={copiar ?? valor} etiqueta={nombre} />}
      </dd>
    </div>
  );
}

/**
 * Datos de la cuenta para transferir: importe (primero y destacado), alias, CBU, banco, titular y CUIT. Se usa en el
 * paso Pago del checkout, en Pedido recibido y en el detalle del pedido de Mi cuenta. `cuenta`
 * es la vista previa (checkout) o el snapshot congelado del pedido; `null` = sin cuenta aplicable.
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
    <dl className={`divide-y divide-border/50 rounded-lg border border-border/50 bg-surface px-4 py-2 text-sm ${className}`}>
      {importe !== undefined && <Fila nombre="Importe" valor={fmtPrecio(importe)} copiar={importeParaCopiar(importe)} destacada />}
      <Fila nombre="Alias" valor={cuenta.alias} copiable />
      <Fila nombre="CBU" valor={cuenta.cbu} copiable />
      {cuenta.banco && <Fila nombre="Banco" valor={cuenta.banco} />}
      {cuenta.titular && <Fila nombre="Titular" valor={cuenta.titular} />}
      {cuenta.cuit && <Fila nombre="CUIT" valor={cuenta.cuit} />}
    </dl>
  );
}
