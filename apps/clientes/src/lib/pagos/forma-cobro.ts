import type { OpcionCobro } from "./opciones-cobro";
import type { TipoMedioPago } from "./tipos";

/**
 * Forma de pago (crédito, débito, cuenta de Mercado Pago) que corresponde al tipo REAL con que el
 * procesador dice que se cobró (`InfoPago.tipo`). Una prepaga se trata como débito. Un tipo ausente o
 * que no se puede mapear (ticket, transferencia, id desconocido) devuelve null: no se acusa.
 */
export function formaDelTipoInfo(tipo: TipoMedioPago | string | null | undefined): OpcionCobro | null {
  switch (tipo) {
    case "credito":
      return "credito";
    case "debito":
    case "prepaga":
      return "debito";
    case "dinero_en_cuenta":
      return "cuenta_mp";
    default:
      return null;
  }
}

/**
 * Red post-cobro: ¿el tipo real del pago difiere de la forma congelada en el pedido? Pedido sin forma
 * congelada (null) o tipo no mapeable no acusan.
 */
export function motivoFormaDistinta(
  formaCobro: OpcionCobro | string | null | undefined,
  infoTipo: TipoMedioPago | string | null | undefined,
): "forma_distinta" | null {
  if (!formaCobro) return null;
  const real = formaDelTipoInfo(infoTipo);
  return real !== null && real !== formaCobro ? "forma_distinta" : null;
}
