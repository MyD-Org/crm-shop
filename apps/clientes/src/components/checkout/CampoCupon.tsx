"use client";

import { useState } from "react";
import { Button, Dialog, Field, Input } from "@myd-org/ui";
import type { CuponAplicado, CuponError } from "@/lib/cupones/tipos";
import { avisoVencimiento } from "@/lib/cupones/ui";
import { BotonQuitarCupon, cuponTieneLinea } from "./LineaCupon";

/**
 * Campo del cupón en el resumen del carrito y del checkout (spec 2026-11-01-cupones-design.md): sin
 * cupón, "¿Tiene un código de descuento?" con el campo y "Aplicar" (Enter también aplica); con cupón,
 * "Condiciones" chico debajo de la línea del cupón y el error o el aviso de vencimiento. El código con
 * la X para quitarlo va acá sólo si el cupón no tiene línea propia en el resumen (`LineaCupon`).
 * Mayúsculas, espacios y guiones dan igual: valida el servidor al cotizar.
 */
export function CampoCupon({
  cupon,
  aplicado,
  error,
  cargando,
  onAplicar,
  onQuitar,
}: {
  cupon: string | null;
  aplicado: CuponAplicado | null;
  error: CuponError | null;
  cargando: boolean;
  onAplicar: (codigo: string) => void;
  onQuitar: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [condiciones, setCondiciones] = useState(false);
  const aplicar = () => {
    if (texto.trim() && !cargando) onAplicar(texto.trim());
  };

  if (!cupon) {
    return (
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="¿Tiene un código de descuento?">
            <Input
              value={texto}
              onChange={(e) => setTexto(e.target.value.slice(0, 32))}
              onKeyDown={(e) => {
                if (e.key === "Enter") aplicar();
              }}
              placeholder="Código"
              autoComplete="off"
              autoCapitalize="characters"
            />
          </Field>
        </div>
        <Button variant="outline" onClick={aplicar} disabled={!texto.trim() || cargando}>
          Aplicar
        </Button>
      </div>
    );
  }

  const vence = aplicado ? avisoVencimiento(aplicado.venceEn, new Date()) : null;
  // Con línea propia en el resumen (`LineaCupon`), el código y la X ya están ahí: acá sólo "Condiciones".
  const conLinea = !!aplicado && cuponTieneLinea(aplicado);
  const codigo = (aplicado?.codigo ?? cupon).toUpperCase();
  return (
    <div className="space-y-1 text-sm">
      {!conLinea && (
        <div className="flex items-center gap-1">
          <span className="font-semibold tabular-nums text-text">{codigo}</span>
          <BotonQuitarCupon codigo={codigo} onQuitar={onQuitar} />
        </div>
      )}
      {aplicado?.condiciones && (
        <button
          type="button"
          className="text-xs text-muted underline underline-offset-2 hover:text-text hover:no-underline"
          onClick={() => setCondiciones(true)}
        >
          Condiciones
        </button>
      )}
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error.mensaje}
        </p>
      )}
      {vence && <p className="text-xs text-muted">{vence}</p>}
      {aplicado?.condiciones && (
        <Dialog open={condiciones} onOpenChange={setCondiciones} title={`Condiciones del cupón ${aplicado.codigo}`} size="md">
          <p className="whitespace-pre-line text-sm text-text">{aplicado.condiciones}</p>
        </Dialog>
      )}
    </div>
  );
}
