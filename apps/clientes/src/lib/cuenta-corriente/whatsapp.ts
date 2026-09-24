/**
 * Mensajes de WhatsApp del cliente a la empresa (facturas, pagos, presupuestos).
 * Módulo puro: lo usan servidor y cliente.
 *
 * Portado de apps/admin/src/lib/whatsapp.ts, con el copy revisado a usted y la
 * fecha de cada documento. El cliente se identifica por razón social y CUIT (un
 * dato que la empresa reconoce), nunca por el id interno de Alegra.
 */
import { fmtPrecio } from "../format";
import type { Factura, FacturaEstado, Pago, Presupuesto } from "./tipos";

export type IntencionFacturas = "pagar" | "consultar";
export type IntencionPresupuestos = "avanzar" | "consultar";

const ESTADO_FACTURA: Record<FacturaEstado, string> = {
  pendiente: "Pendiente",
  vencida: "Vencida",
  pagada: "Pagada",
  anulada: "Anulada",
};

export interface DatosMensaje {
  /** Nombre de la empresa (tenant). */
  empresa: string;
  razonsocial: string;
  cuit: string;
}

/** `https://wa.me/<número>?text=…`, o `null` si la empresa no tiene WhatsApp cargado. */
export function enlaceWhatsApp(numero: string | null | undefined, mensaje: string): string | null {
  const digitos = (numero ?? "").replace(/\D/g, "");
  if (!digitos) return null;
  return `https://wa.me/${digitos}?text=${encodeURIComponent(mensaje)}`;
}

function encabezado({ empresa, razonsocial, cuit }: DatosMensaje): string {
  const id = cuit ? ` (CUIT ${cuit})` : "";
  return `Hola, ${empresa}. Les escribimos de ${razonsocial}${id}.`;
}

type FacturaMensaje = Pick<Factura, "id" | "emision" | "importe" | "estado" | "pagado">;

/** Saldo pendiente de una factura (anulada = 0). */
function saldoDe(f: FacturaMensaje): number {
  return f.estado === "anulada" ? 0 : f.importe - (f.pagado ?? 0);
}

export function mensajeFacturas(intencion: IntencionFacturas, datos: DatosMensaje, facturas: FacturaMensaje[]): string {
  const intro =
    intencion === "pagar"
      ? "Queremos coordinar el pago de las siguientes facturas:"
      : "Tenemos una consulta sobre las siguientes facturas:";
  const lineas = facturas
    .map((f) => {
      const parcial = f.pagado !== undefined && f.pagado > 0 && f.pagado < f.importe;
      const monto = parcial ? `saldo ${fmtPrecio(saldoDe(f))}` : fmtPrecio(f.importe);
      return `• ${f.id} del ${f.emision}: ${monto} (${ESTADO_FACTURA[f.estado]})`;
    })
    .join("\n");
  const total = facturas.reduce((s, f) => s + saldoDe(f), 0);
  const cierre = intencion === "consultar" ? "\n\nConsulta: " : "";
  return `${encabezado(datos)}\n\n${intro}\n${lineas}\n\nSaldo total: ${fmtPrecio(total)}${cierre}`;
}

export function mensajePagos(datos: DatosMensaje, pagos: Pick<Pago, "id" | "fecha" | "medio" | "monto">[]): string {
  const lineas = pagos
    .map((p) => `• ${p.id} del ${p.fecha}${p.medio ? ` (${p.medio})` : ""}: ${fmtPrecio(p.monto)}`)
    .join("\n");
  return `${encabezado(datos)}\n\nTenemos una consulta sobre los siguientes pagos:\n${lineas}\n\nConsulta: `;
}

export function mensajePresupuestos(
  intencion: IntencionPresupuestos,
  datos: DatosMensaje,
  presupuestos: Pick<Presupuesto, "id" | "fecha" | "total">[],
): string {
  const intro =
    intencion === "avanzar"
      ? "Queremos avanzar con los siguientes presupuestos:"
      : "Tenemos una consulta sobre los siguientes presupuestos:";
  const lineas = presupuestos.map((p) => `• ${p.id} del ${p.fecha}: ${fmtPrecio(p.total)}`).join("\n");
  const cierre = intencion === "consultar" ? "\n\nConsulta: " : "";
  return `${encabezado(datos)}\n\n${intro}\n${lineas}${cierre}`;
}
