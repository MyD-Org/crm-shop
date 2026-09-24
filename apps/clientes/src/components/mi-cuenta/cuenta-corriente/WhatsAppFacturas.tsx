"use client";

import { Button, SelectionBar, type RenderLink } from "@myd-org/ui";
import { fmtPrecio } from "@/lib/format";
import { enlaceWhatsApp, mensajeFacturas, type DatosMensaje } from "@/lib/cuenta-corriente/whatsapp";
import { saldoDe } from "@/lib/cuenta-corriente/vista-facturas";
import type { Factura } from "@/lib/cuenta-corriente/tipos";

export interface ContactoWhatsApp {
  /** Número de la empresa, sólo dígitos. */
  numero: string;
  datos: DatosMensaje;
}

/** WhatsApp se abre en otra pestaña (o la app): el cliente no pierde la lista. */
const enlaceExterno: RenderLink = (props) => <a {...props} target="_blank" rel="noopener noreferrer" />;

/**
 * Barra de la selección de facturas: "Pagar" o "Consultar" arma el mensaje a
 * la empresa con razón social, CUIT y cada factura (número, fecha y saldo). Sin
 * WhatsApp cargado no se renderiza (quien la usa ni siquiera ofrece elegir).
 */
export function WhatsAppFacturas({
  contacto,
  seleccionadas,
  onLimpiar,
}: {
  contacto: ContactoWhatsApp;
  seleccionadas: Factura[];
  onLimpiar: () => void;
}) {
  const pagar = enlaceWhatsApp(contacto.numero, mensajeFacturas("pagar", contacto.datos, seleccionadas));
  const consultar = enlaceWhatsApp(contacto.numero, mensajeFacturas("consultar", contacto.datos, seleccionadas));
  const saldo = seleccionadas.reduce((s, f) => s + saldoDe(f), 0);
  const n = seleccionadas.length;

  return (
    <SelectionBar
      count={n}
      label={n === 1 ? "1 factura seleccionada" : `${n} facturas seleccionadas`}
      summary={`Saldo: ${fmtPrecio(saldo)}`}
      emptyHint="Seleccione facturas para pagarlas o consultarlas por WhatsApp."
      onClear={onLimpiar}
    >
      {pagar && (
        <Button size="sm" variant="secondary" href={pagar} renderLink={enlaceExterno}>
          Pagar
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
