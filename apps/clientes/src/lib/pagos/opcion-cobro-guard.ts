import { NextResponse } from "next/server";
import { leerMediosPagoTolerante } from "@/lib/medios-pago-repo";
import { opcionHabilitada, type OpcionCobro } from "./opciones-cobro";
import { MENSAJE_RECHAZO } from "./tipos";

export const MSG_MEDIO_NO_VERIFICADO =
  "No pudimos verificar el medio de pago. Inténtelo de nuevo en unos minutos.";

/**
 * ¿El medio del pedido acepta esta forma de pago (migración 0073 del CRM)? Devuelve la respuesta de
 * rechazo, o `null` si se puede seguir. Lo llaman las rutas de cobro ANTES de reservar el intento y de
 * hablar con el procesador.
 *
 * Lee los medios SIN caché: deshabilitar una opción en el admin rige en el próximo cobro. Si el medio
 * no se puede leer (o no está), falla cerrado con 502: no se cobra lo que no se pudo verificar. NO se
 * exige que el medio esté activo (un pedido en vuelo se paga aunque el operador lo desactive): sólo
 * cuenta la forma de pago.
 */
export async function rechazoPorOpcionDeCobro(
  pagoMetodo: string,
  procesadorId: string,
  opcion: OpcionCobro,
): Promise<NextResponse | null> {
  const medio = (await leerMediosPagoTolerante()).find((m) => m.slug === pagoMetodo);
  if (!medio) {
    return NextResponse.json({ error: MSG_MEDIO_NO_VERIFICADO, motivo: "medio_no_verificado" }, { status: 502 });
  }
  if (opcionHabilitada(procesadorId, medio.opcionesCobro, opcion)) return null;
  return NextResponse.json(
    { error: MENSAJE_RECHAZO.opcion_no_habilitada, motivo: "opcion_no_habilitada" },
    { status: 422 },
  );
}
