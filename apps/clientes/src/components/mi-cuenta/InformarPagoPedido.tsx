"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { InformarPago } from "./cuenta-corriente/InformarPago";

/** Query del link "Cargar comprobante" (card de Mis pedidos): el detalle abre el formulario solo. */
export const QUERY_SUBIR_COMPROBANTE = "subir=comprobante";

/**
 * "Subir comprobante" del detalle de un pedido por transferencia (Mi cuenta → Pedidos). Es el
 * mismo formulario de Informar pago, con el medio fijo en transferencia, el monto precargado con
 * el total del pedido (editable) y el pedido en el init. Sirve a cualquier comprador logueado,
 * con o sin cuenta corriente. Al informar refresca la página.
 *
 * Con `?subir=comprobante` (el link de la card) el formulario se abre al llegar, y la query se saca
 * de la URL para que un refresco no lo vuelva a abrir.
 */
export function InformarPagoPedido({ pedido }: { pedido: { id: string; numero: string; total: number } }) {
  const router = useRouter();
  const [abrir, setAbrir] = useState(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("subir") !== "comprobante") return;
    url.searchParams.delete("subir");
    window.history.replaceState(window.history.state, "", url.toString());
    // Se lee la URL recién en el navegador (sin useSearchParams: no fuerza un Suspense en la página).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAbrir(true);
  }, []);
  // `key`: con la query, el formulario se monta de nuevo ya abierto.
  return (
    <InformarPago
      key={abrir ? "abierto" : "cerrado"}
      ultimos={[]}
      pedido={pedido}
      abrirAlMontar={abrir}
      onInformado={() => router.refresh()}
    />
  );
}
