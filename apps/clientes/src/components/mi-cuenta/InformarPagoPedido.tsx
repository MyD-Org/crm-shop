"use client";

import { useRouter } from "next/navigation";
import { InformarPago } from "./cuenta-corriente/InformarPago";

/**
 * "Subir comprobante" del detalle de un pedido por transferencia (Mi cuenta → Pedidos). Es el
 * mismo formulario de Informar pago, con el medio fijo en transferencia, el monto precargado con
 * el total del pedido (editable) y el pedido en el init. Sirve a cualquier comprador logueado,
 * con o sin cuenta corriente. Al informar refresca la página.
 */
export function InformarPagoPedido({ pedido }: { pedido: { id: string; numero: string; total: number } }) {
  const router = useRouter();
  return <InformarPago ultimos={[]} pedido={pedido} onInformado={() => router.refresh()} />;
}
