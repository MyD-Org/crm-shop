"use client";

import { useOptimistic, useTransition } from "react";
import { Switch, useToast } from "@myd-org/ui";
import { guardarDecoracion } from "@/lib/home-acciones";

/**
 * Interruptor de la barra de edición: prende o apaga la textura de piedra de TODO el sitio (login,
 * pie, 404, carrito vacío y la banda "Visítenos"). Se aplica al instante y se guarda aparte del
 * resto de los editores.
 */
export function InterruptorPiedra({ inicial }: { inicial: boolean }) {
  const [activa, setActiva] = useOptimistic(inicial);
  const [, startTransition] = useTransition();
  const { toast } = useToast();

  function cambiar(nueva: boolean) {
    startTransition(async () => {
      setActiva(nueva);
      const r = await guardarDecoracion({ piedra: nueva });
      if (!r.ok) {
        toast({ title: r.errores[0] ?? "No se pudo guardar la apariencia de la tienda.", tone: "danger" });
        return;
      }
      toast({ title: nueva ? "Textura de piedra activada" : "Textura de piedra desactivada", tone: "success" });
    });
  }

  return <Switch label="Usar la textura de piedra en la tienda" checked={activa} onCheckedChange={cambiar} />;
}
