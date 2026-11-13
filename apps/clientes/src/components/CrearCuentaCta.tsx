import Link from "next/link";
import { Button } from "@myd-org/ui";
import { TEXTOS_CREAR_CUENTA } from "@/lib/pagar-textos";

/**
 * «Cree su cuenta» al terminar la compra del invitado (change `compra-como-invitado`, S3). Sólo lleva
 * a `/registro?email=` (Clerk: Google o correo electrónico): no pide ni envía datos del pedido, y no
 * guarda nada en el navegador. Los pedidos con ese correo se asocian solos cuando la cuenta tiene el
 * correo verificado (`reclamo-invitado.ts`).
 */
export function CrearCuentaCta({ email, className }: { email?: string | null; className?: string }) {
  const href = email ? `/registro?email=${encodeURIComponent(email)}` : "/registro";
  return (
    <section data-crear-cuenta className={`rounded-2xl border border-border bg-surface-2 p-5 text-center ${className ?? ""}`}>
      <h2 className="text-base font-bold text-text">{TEXTOS_CREAR_CUENTA.titulo}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{TEXTOS_CREAR_CUENTA.descripcion}</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-muted">{TEXTOS_CREAR_CUENTA.asociacion}</p>
      <Link href={href} className="mt-3 inline-block">
        <Button>{TEXTOS_CREAR_CUENTA.boton}</Button>
      </Link>
    </section>
  );
}
