import { Button } from "@myd-org/ui";
import { rutaIngreso } from "@/lib/ingreso";
import { TEXTOS_INVITADO as T } from "@/lib/invitado-textos";

/**
 * «Está comprando como invitado» con Ingresar y Crear cuenta (change `compra-como-invitado`). Uno solo
 * para el carrito y el checkout, así las dos pantallas muestran lo mismo. Ambos botones vuelven a
 * `volverA` después de ingresar o registrarse.
 */
export function AvisoInvitado({ volverA, className }: { volverA: string; className?: string }) {
  return (
    <div
      data-aviso-invitado
      className={`flex flex-col gap-3 rounded-[20px] border border-border bg-elevated p-4 text-sm sm:flex-row sm:items-center sm:justify-between ${className ?? ""}`}
    >
      <p className="font-semibold text-text">{T.carritoTitulo}</p>
      <div className="flex shrink-0 gap-2">
        <Button variant="outline" size="sm" href={rutaIngreso(volverA)}>
          {T.botonIngresar}
        </Button>
        <Button variant="outline" size="sm" href={`/registro?redirect_url=${encodeURIComponent(volverA)}`}>
          {T.botonRegistrarse}
        </Button>
      </div>
    </div>
  );
}
