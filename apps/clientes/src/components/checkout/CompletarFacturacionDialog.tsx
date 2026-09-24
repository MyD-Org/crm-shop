"use client";

import { useRouter } from "next/navigation";
import { Dialog } from "@myd-org/ui";
import { FacturacionForm, type PerfilFacturacionUI } from "@/components/FacturacionForm";
import type { Complemento } from "@/lib/contacto-alegra";
import type { DatosDelContactoPublico } from "@/lib/datos-del-contacto";
import { CompletarFacturacionForm } from "./CompletarFacturacionForm";

/**
 * Modal para cargar los datos de facturación que faltan, sin salir del checkout
 * ni de Mis datos (change `contacto-fuente-unica`). `Dialog` de @myd-org/ui.
 *
 * - No vinculado: el formulario de siempre (`FacturacionForm`), que crea o
 *   actualiza su perfil.
 * - Vinculado: sólo lo que falta en su cuenta de Alegra
 *   (`CompletarFacturacionForm`).
 *
 * Guardado en Alegra o en el perfil ⇒ se cierra y se relee (`router.refresh()`;
 * el carrito vive en su contexto y no se pierde). Con la cookie del CRM y Alegra
 * sin responder, lo cargado vuelve al checkout para ir con el pedido
 * (`onEnPedido`).
 */
export function CompletarFacturacionDialog({
  abierto,
  onOpenChange,
  facturacion,
  perfil,
  nombreSugerido,
  onEnPedido,
  descripcion = "Los necesitamos para emitirle la factura de esta compra. Se cargan una sola vez.",
}: {
  abierto: boolean;
  onOpenChange: (abierto: boolean) => void;
  facturacion: DatosDelContactoPublico;
  /** Perfil del no vinculado, para precargar el formulario. */
  perfil: PerfilFacturacionUI | null;
  nombreSugerido?: string;
  onEnPedido?: (complemento: Complemento) => void;
  descripcion?: string;
}) {
  const router = useRouter();

  function listo() {
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={onOpenChange}
      title="Datos de facturación"
      description={descripcion}
      size="md"
    >
      {abierto &&
        (facturacion.vinculado ? (
          <CompletarFacturacionForm
            facturacion={facturacion}
            onResultado={(r) => {
              if (r.estado === "en_pedido") {
                onEnPedido?.(r.complemento);
                onOpenChange(false);
                return;
              }
              listo();
            }}
          />
        ) : (
          <FacturacionForm perfil={perfil} nombreSugerido={nombreSugerido} onGuardado={listo} />
        ))}
    </Dialog>
  );
}
