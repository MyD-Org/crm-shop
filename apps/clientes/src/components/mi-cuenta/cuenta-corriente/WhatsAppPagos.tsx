"use client";

import { Button, SelectionBar } from "@myd-org/ui";
import { fmtPrecio } from "@/lib/format";
import type { Pago } from "@/lib/cuenta-corriente/tipos";
import { enlaceWhatsApp, mensajePagos, type ContactoWhatsApp } from "@/lib/cuenta-corriente/whatsapp";
import { enlaceExterno } from "./WhatsAppFacturas";

/**
 * Barra de la selección de pagos: "Consultar" arma el mensaje a la empresa con
 * razón social, CUIT y cada pago (número, fecha, medio y monto). Sin WhatsApp
 * cargado no se renderiza (PAG-3).
 */
export function WhatsAppPagos({
  contacto,
  seleccionados,
  onLimpiar,
}: {
  contacto: ContactoWhatsApp;
  seleccionados: Pago[];
  onLimpiar: () => void;
}) {
  const consultar = enlaceWhatsApp(contacto.numero, mensajePagos(contacto.datos, seleccionados));
  const monto = seleccionados.reduce((s, p) => s + p.monto, 0);
  const n = seleccionados.length;

  return (
    <SelectionBar
      count={n}
      label={n === 1 ? "1 pago seleccionado" : `${n} pagos seleccionados`}
      summary={`Total: ${fmtPrecio(monto)}`}
      emptyHint="Seleccione pagos para consultarlos por WhatsApp."
      onClear={onLimpiar}
    >
      {consultar && (
        <Button size="sm" variant="secondary" href={consultar} renderLink={enlaceExterno}>
          Consultar
        </Button>
      )}
    </SelectionBar>
  );
}
