"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, useToast } from "@myd-org/ui";
import { useCart } from "@/context/CartContext";
import type { CartItem } from "@/lib/carrito-cliente";
import { accionAlCompartir } from "@/lib/carrito-compartido";
import { useAlOcultar } from "@/lib/use-al-ocultar";

/**
 * "Cargar al carrito" de un carrito compartido. Abrir la página no toca nada:
 * la carga es siempre un toque del usuario (los bots de vista previa de los
 * chats también abren el link).
 *
 * Carrito vacío → se carga directo. Mismo contenido → sólo se va al carrito.
 * Otro carrito → el usuario elige reemplazar o sumar; nunca se pisa solo.
 */
export function CargarCompartido({ items: compartidos }: { items: CartItem[] }) {
  const { items, ready, addItems, replaceItems } = useCart();
  const { toast } = useToast();
  const router = useRouter();
  const [preguntando, setPreguntando] = useState(false);
  // Evita cargar dos veces con un doble toque antes de llegar al carrito. Con
  // Cache Components la página queda montada al navegar: se resetea al ocultar.
  const [cargando, setCargando] = useState(false);
  useAlOcultar(() => {
    setCargando(false);
    setPreguntando(false);
  });

  const lista = compartidos.map(({ qty, ...item }) => ({ item, qty }));

  function terminar(titulo: string) {
    toast({
      title: titulo,
      description: "Confirmamos precio y stock actuales en el carrito.",
      tone: "success",
    });
    router.push("/carrito");
  }

  function reemplazar() {
    if (cargando) return;
    setCargando(true);
    replaceItems(lista);
    terminar("Carrito cargado");
  }

  function sumar() {
    if (cargando) return;
    setCargando(true);
    addItems(lista);
    terminar("Productos agregados a su carrito");
  }

  function cargar() {
    // Sin `ready` el carrito visible es el vacío del servidor: decidir sobre
    // eso pisaría el carrito real sin preguntar.
    if (!ready || cargando) return;
    const accion = accionAlCompartir(items, compartidos);
    if (accion === "cargar") reemplazar();
    else if (accion === "igual") router.push("/carrito");
    else setPreguntando(true);
  }

  return (
    <>
      <Button type="button" className="w-full" disabled={!ready || cargando} onClick={cargar}>
        Cargar al carrito
      </Button>
      <Dialog
        open={preguntando}
        onOpenChange={setPreguntando}
        title="Ya tiene productos en su carrito"
        description="Puede reemplazar su carrito por el compartido o sumar estos productos a los que ya tiene."
        size="md"
        footer={
          // En el celular, apilados y con la acción principal arriba: en fila no entran.
          <div className="flex w-full flex-col gap-2 sm:flex-row-reverse sm:justify-start">
            <Button type="button" onClick={reemplazar} disabled={cargando}>
              Reemplazar mi carrito
            </Button>
            <Button type="button" variant="outline" onClick={sumar} disabled={cargando}>
              Sumar a mi carrito
            </Button>
            <Button type="button" variant="ghost" onClick={() => setPreguntando(false)} disabled={cargando}>
              Cancelar
            </Button>
          </div>
        }
      />
    </>
  );
}
