import { NextResponse } from "next/server";
import { identidadActual } from "@/lib/auth";
import { pagoTransferenciaDelVisitante } from "@/lib/pago-transferencia-servidor";

/**
 * Lista con la que se cotiza el precio con transferencia para quien mira (`{ pago: null }` = sin
 * precio con transferencia). La usa la hoja del carrito del celular, que vive en el layout
 * estático y no puede leer el request. Retiro: el mismo punto de partida que la hoja.
 */
export async function GET() {
  try {
    const { cliente } = await identidadActual();
    const pago = await pagoTransferenciaDelVisitante(cliente, "retiro");
    return NextResponse.json({ pago }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error("[pago-transferencia] no se pudo resolver:", err);
    return NextResponse.json({ pago: null }, { headers: { "Cache-Control": "private, no-store" } });
  }
}
