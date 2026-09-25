"use client";

import { useEffect } from "react";
import { UMBRAL_INTENCION, arrastraLaHoja, debeCerrarHoja } from "@/lib/hoja-arrastre";

const DURACION_MS = 200;

/**
 * Arrastrar hacia abajo para cerrar la hoja de filtros, como las hojas nativas
 * del celular. El `Dialog` del DS no lo trae y no expone su contenido, así que
 * se engancha desde `ancla`: un elemento cualquiera dentro del cuerpo de la
 * hoja. Desde ahí se llega al contenido (`role="dialog"`), a su encabezado
 * (primer hijo) y al cuerpo scrolleable (el padre del ancla).
 *
 * La hoja sigue al dedo si el gesto arranca en el encabezado, o en el cuerpo
 * cuando ya está arriba de todo; si no, el cuerpo scrollea como siempre. El
 * slider de precio (`touch-none`) queda afuera: ahí el dedo mueve el slider.
 * Al soltar, si se la bajó lo suficiente (ver `debeCerrarHoja`) termina de
 * bajar y se cierra; si no, vuelve a su lugar.
 *
 * `ancla` viene de un callback ref en estado: el portal de Radix monta el
 * contenido después del render que abre la hoja.
 */
export function useArrastrarParaCerrar(ancla: HTMLElement | null, cerrar: () => void) {
  useEffect(() => {
    const cuerpo = ancla?.parentElement;
    const hoja = ancla?.closest<HTMLElement>('[role="dialog"]');
    const encabezado = hoja?.firstElementChild;
    if (!cuerpo || !hoja || !encabezado) return;
    const sinMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let estado: "quieto" | "indeciso" | "arrastrando" | "libre" = "quieto";
    let origen: { x: number; y: number; enEncabezado: boolean } | null = null;
    let ultimo = { y: 0, t: 0 };
    let velocidad = 0;
    let desplazamiento = 0;
    let cierre: ReturnType<typeof setTimeout> | undefined;

    const mover = (px: number, animar: boolean) => {
      hoja.style.transition = animar && !sinMovimiento ? `transform ${DURACION_MS}ms ease-out` : "none";
      hoja.style.transform = px ? `translateY(${px}px)` : "";
    };

    const alTocar = (e: TouchEvent) => {
      const t = e.touches[0];
      const destino = e.target as Element | null;
      if (e.touches.length !== 1 || destino?.closest(".touch-none")) {
        estado = "libre";
        return;
      }
      estado = "indeciso";
      origen = { x: t.clientX, y: t.clientY, enEncabezado: encabezado.contains(destino) };
      ultimo = { y: t.clientY, t: e.timeStamp };
      velocidad = 0;
      desplazamiento = 0;
    };

    const alMover = (e: TouchEvent) => {
      if (!origen || estado === "libre" || estado === "quieto") return;
      const t = e.touches[0];
      const dx = t.clientX - origen.x;
      const dy = t.clientY - origen.y;
      if (estado === "indeciso") {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < UMBRAL_INTENCION) return;
        estado = arrastraLaHoja({
          dx,
          dy,
          enEncabezado: origen.enEncabezado,
          scrollArriba: cuerpo.scrollTop <= 0,
        })
          ? "arrastrando"
          : "libre";
        if (estado === "libre") return;
      }
      // Arrastrando: el dedo mueve la hoja, no el cuerpo ni la página.
      e.preventDefault();
      const dt = e.timeStamp - ultimo.t;
      if (dt > 0) velocidad = (t.clientY - ultimo.y) / dt;
      ultimo = { y: t.clientY, t: e.timeStamp };
      desplazamiento = Math.max(0, dy);
      mover(desplazamiento, false);
    };

    const alSoltar = () => {
      if (estado === "arrastrando") {
        if (debeCerrarHoja(desplazamiento, hoja.offsetHeight, velocidad)) {
          mover(hoja.offsetHeight, true);
          cierre = setTimeout(cerrar, sinMovimiento ? 0 : DURACION_MS);
        } else {
          mover(0, true);
        }
      }
      estado = "quieto";
      origen = null;
    };

    hoja.addEventListener("touchstart", alTocar, { passive: true });
    // No pasivo: tiene que poder cancelar el scroll mientras arrastra la hoja.
    hoja.addEventListener("touchmove", alMover, { passive: false });
    hoja.addEventListener("touchend", alSoltar);
    hoja.addEventListener("touchcancel", alSoltar);
    return () => {
      clearTimeout(cierre);
      hoja.removeEventListener("touchstart", alTocar);
      hoja.removeEventListener("touchmove", alMover);
      hoja.removeEventListener("touchend", alSoltar);
      hoja.removeEventListener("touchcancel", alSoltar);
    };
  }, [ancla, cerrar]);
}
