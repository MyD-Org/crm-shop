"use client";

import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { useToast } from "@myd-org/ui";
import { useCart } from "@/context/CartContext";
import { limpiarCupon } from "@/lib/carrito-cliente";
import { avisoCuponGuardado } from "@/lib/cupones/ui";

/**
 * Link con cupón (`/?cupon=LUZ-7KQ2M`, lo manda el bot de Instagram): guarda el código en el carrito
 * (servidor con sesión, navegador si no), avisa y saca el parámetro de la URL para que un refresco no
 * lo repita. Espera a que Clerk cargue y guarda en el próximo tick: el carrito (efecto del padre)
 * tiene que conocer la sesión antes, o el cupón caería en un carrito de invitado. La validación es
 * del servidor al cotizar.
 */
export function CapturaCupon() {
  const { isLoaded } = useAuth();
  const { setCupon } = useCart();
  const { toast } = useToast();
  useEffect(() => {
    if (!isLoaded) return;
    const url = new URL(window.location.href);
    const raw = url.searchParams.get("cupon");
    if (raw === null) return;
    url.searchParams.delete("cupon");
    window.history.replaceState(window.history.state, "", url.toString());
    const cupon = limpiarCupon(raw);
    if (!cupon) return;
    const t = window.setTimeout(() => {
      setCupon(cupon);
      toast({ title: avisoCuponGuardado(cupon), tone: "success" });
    }, 0);
    return () => window.clearTimeout(t);
  }, [isLoaded, setCupon, toast]);
  return null;
}
