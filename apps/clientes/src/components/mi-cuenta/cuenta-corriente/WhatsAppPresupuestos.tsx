"use client";

import { Button, SelectionBar } from "@myd-org/ui";
import { fmtPrecio } from "@/lib/format";
import type { Presupuesto } from "@/lib/cuenta-corriente/tipos";
import { enlaceWhatsApp, mensajePresupuestos, type ContactoWhatsApp } from "@/lib/cuenta-corriente/whatsapp";
import { enlaceExterno } from "./WhatsAppFacturas";

/**
 * Barra de la selección de presupuestos: "Avanzar" o "Consultar" arma el
 * mensaje a la empresa con razón social, CUIT y cada presupuesto (número, fecha
 * y total). Sin WhatsApp cargado no se renderiza (PRE-2).
 */
export function WhatsAppPresupuestos({
  contacto,
  seleccionados,
  onLimpiar,
}: {
  contacto: ContactoWhatsApp;
  seleccionados: Presupuesto[];
  onLimpiar: () => void;
}) {
  const avanzar = enlaceWhatsApp(contacto.numero, mensajePresupuestos("avanzar", contacto.datos, seleccionados));
  const consultar = enlaceWhatsApp(contacto.numero, mensajePresupuestos("consultar", contacto.datos, seleccionados));
  const total = seleccionados.reduce((s, p) => s + p.total, 0);
  const n = seleccionados.length;

  return (
    <SelectionBar
      count={n}
      label={n === 1 ? "1 presupuesto seleccionado" : `${n} presupuestos seleccionados`}
      summary={`Total: ${fmtPrecio(total)}`}
      emptyHint="Seleccione presupuestos para avanzar o consultarlos por WhatsApp."
      onClear={onLimpiar}
    >
      {avanzar && (
        <Button size="sm" variant="secondary" href={avanzar} renderLink={enlaceExterno}>
          Avanzar
        </Button>
      )}
      {consultar && (
        <Button size="sm" variant="secondary" href={consultar} renderLink={enlaceExterno}>
          Consultar
        </Button>
      )}
    </SelectionBar>
  );
}
