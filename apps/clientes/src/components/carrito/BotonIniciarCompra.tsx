import Link from "next/link";
import { Button } from "@myd-org/ui";
import { eventoMuroIngreso } from "@/lib/tracking/eventos";
import { track } from "@/lib/tracking/track";

/**
 * «Iniciar compra» del carrito. Sin sesión, `/checkout` manda a ingresar: ese es el muro del
 * embudo anónimo, y se mide acá (antes de navegar) para poder comparar contra la etapa con
 * compra como invitado. Con sesión no se emite nada. Sin hooks a propósito: se prueba llamándolo
 * como función.
 */
export function BotonIniciarCompra({
  anonimo,
  items,
  total,
  bloqueado,
  etiquetaBloqueado,
}: {
  /** Sin sesión (o con la sesión vencida): el checkout lo manda a ingresar. */
  anonimo: boolean;
  items: { price: number; qty: number }[];
  /** Total cotizado, si ya llegó. */
  total: number | null;
  bloqueado?: boolean;
  etiquetaBloqueado?: string;
}) {
  return (
    <Link
      href="/checkout"
      className="block"
      aria-disabled={bloqueado || undefined}
      onClick={() => {
        if (anonimo) track(eventoMuroIngreso(items, total));
      }}
    >
      <Button className="w-full" disabled={bloqueado}>
        {bloqueado && etiquetaBloqueado ? etiquetaBloqueado : "Iniciar compra"}
      </Button>
    </Link>
  );
}
