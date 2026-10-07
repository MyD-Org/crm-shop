/**
 * "Cambiar medio de pago" desde la pantalla de cobro en línea.
 *
 * Diseño: el MISMO pedido (mismo id y número). El botón vuelve siempre al paso Pago y, al
 * confirmar, el cliente llama a `POST /api/pedidos/:id/medio` en vez de crear un pedido. El servidor
 * (`cambiarMedioPedido`, una transacción con el lock del pedido) valida dueño, estado pendiente, que no
 * haya cobro en vuelo, pago aprobado ni comprobante informado (409 en usted), revalida que el medio sea
 * ofrecible y recotiza con las mismas funciones que crear (`cotizarConMedio`). Las cantidades no cambian:
 * la reserva se mantiene. El mail de "pedido recibido" sale sólo si el medio nuevo es sin cobro en línea.
 */

/** Sólo se ofrece sin cobro aprobado ni en vuelo: formulario sin enviar o tras un rechazo. */
export function puedeCambiarMedioPago(e: { pagado: boolean; pagoEnConfirmacion: boolean }): boolean {
  return !e.pagado && !e.pagoEnConfirmacion;
}

export interface EntregaDelPedido {
  tipo: "retiro" | "envio";
  local: string | null;
  ciudad: string | null;
  direccion: string | null;
}

export interface PrecargaEntrega {
  opcion: "retiro" | "domicilio";
  /** Local de retiro, sólo si es uno de los que ofrece el checkout. */
  local: string | null;
  /** Dirección guardada que coincide con la del pedido; null = "otra dirección" con `tipeada`. */
  direccionGuardada: string | null;
  tipeada: { ciudad: string; direccion: string };
}

const igual = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/**
 * Con un pedido retomado (recarga, vuelta de Mercado Pago o `?pedido=`) el formulario no tiene la
 * entrega cargada: se precarga con la del pedido para que "Cambiar medio de pago" vaya directo al paso
 * Pago. El servidor no la vuelve a pedir (el cambio de medio usa la entrega guardada en el pedido): es
 * para que la cotización de la pantalla sea la del pedido.
 */
export function precargaDeEntrega(
  e: EntregaDelPedido,
  direcciones: { id: string; ciudad: string; direccion: string }[],
  locales: string[],
): PrecargaEntrega {
  const tipeada = { ciudad: e.ciudad ?? "", direccion: e.direccion ?? "" };
  if (e.tipo === "retiro") {
    return { opcion: "retiro", local: e.local && locales.includes(e.local) ? e.local : null, direccionGuardada: null, tipeada };
  }
  const guardada = direcciones.find((d) => igual(d.direccion, e.direccion) && igual(d.ciudad, e.ciudad));
  return { opcion: "domicilio", local: null, direccionGuardada: guardada?.id ?? null, tipeada };
}
