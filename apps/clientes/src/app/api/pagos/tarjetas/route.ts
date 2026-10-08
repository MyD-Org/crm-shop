import { NextResponse } from "next/server";
import { getTarjetasMercadoPago } from "@/lib/pagos/tarjetas-aceptadas-mp";

/**
 * GET /api/pagos/tarjetas — tarjetas aceptadas (crédito y débito) con su logo, para "Ver tarjetas aceptadas"
 * del checkout. Pública: es la misma lista que muestra el footer. Cacheada en el servidor.
 */
export async function GET() {
  return NextResponse.json(await getTarjetasMercadoPago());
}
