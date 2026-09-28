"use client";

import { type PointerEvent, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { nombreConMarca } from "@/lib/formato-nombre";
import { formatMarca } from "@/lib/formato-rubro";
import { Button } from "@myd-org/ui";
import { useCart } from "@/context/CartContext";
import { fmtPrecio } from "@/lib/format";
import { useHidratado } from "@/lib/hidratado";
import type { CartItem } from "@/lib/carrito-cliente";

const SIN_ITEMS: CartItem[] = [];

function CartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}

function LightbulbIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 7 7c0 3.5-2 5.5-2.5 6.5H7.5C7 15.5 5 13.5 5 9a7 7 0 0 1 7-7z" />
    </svg>
  );
}

// El mismo formateador que la página del carrito y el checkout, con dos
// decimales siempre: el preview es el mismo carrito y tiene que decir los
// mismos números. El de antes tenía `minimumFractionDigits: 0` sin máximo, así
// que $2.344.755,60 salía "$ 2.344.755,6", con un solo decimal.
const fmt = fmtPrecio;

/** La misma curva que el popover de acá y el stepper de AddToCartButton. */
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

function prefiereMenosMovimiento() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Latido del ícono: sube rápido y se asienta, 300 ms. Arranca desde la escala
 * en la que esté (si un cambio llega a mitad del latido anterior, lo retoma en
 * vez de saltar a 1), así varios cambios seguidos no se acumulan ni tironean.
 */
function latir(el: HTMLElement) {
  const actual = parseFloat(getComputedStyle(el).scale);
  const desde = Number.isFinite(actual) ? actual : 1;
  for (const a of el.getAnimations()) a.cancel();
  el.animate(
    [
      { scale: desde, easing: EASE_OUT },
      { scale: 1.15, offset: 0.3, easing: EASE_OUT },
      { scale: 1 },
    ],
    { duration: 300 },
  );
}

/**
 * Feedback de un cambio de cantidad sobre el botón del carrito, en lugar de
 * abrir el popover: el ícono late y el número nuevo entra desde abajo si subió
 * o desde arriba si bajó (el chip lo recorta, como un contador que gira). Con
 * reduced motion no se mueve nada: el chip sólo se ilumina y se apaga.
 */
function acusarCambio(icono: HTMLElement, numero: HTMLElement, destello: HTMLElement, sentido: 1 | -1) {
  if (prefiereMenosMovimiento()) {
    destello.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500, easing: "ease" });
    return;
  }
  latir(icono);
  // Cada cambio trae un número nuevo: que vuelva a entrar es lo que
  // corresponde, por eso acá no hace falta retomar la animación anterior.
  numero.animate(
    [
      { translate: sentido === 1 ? "0 70%" : "0 -70%", opacity: 0 },
      { translate: "0 0", opacity: 1 },
    ],
    { duration: 220, easing: EASE_OUT },
  );
}

export function CartPreview({
  pathname = null,
}: {
  /**
   * Ruta actual, la pasa el header. No se lee con `usePathname` acá: en el
   * shell estático de una ruta con parámetros (ficha, pedido) ese hook
   * suspende, y el header se pinta sin ruta (null) hasta que llega el hueco.
   */
  pathname?: string | null;
} = {}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iconoRef = useRef<HTMLSpanElement>(null);
  const numeroRef = useRef<HTMLSpanElement>(null);
  const destelloRef = useRef<HTMLSpanElement>(null);
  const carrito = useCart();
  const { cambio } = carrito;
  // En el hueco del header (se hidrata después del shell) el contexto ya trae
  // el carrito del navegador; el HTML del servidor, el vacío. Hasta terminar
  // de hidratar se repite lo del servidor (ver useHidratado).
  const hidratado = useHidratado();
  const items = hidratado ? carrito.items : SIN_ITEMS;
  const total = hidratado ? carrito.total : 0;
  const count = hidratado ? carrito.count : 0;

  /**
   * Agregar, sumar, restar o quitar NO abre el popover (lo abre sólo el
   * usuario, con hover o clic): el botón acusa el cambio con una animación
   * corta. Layout effect para que el número nuevo no llegue a pintarse quieto
   * un frame antes de entrar.
   */
  useLayoutEffect(() => {
    if (cambio.n === 0) return;
    const icono = iconoRef.current;
    const numero = numeroRef.current;
    const destello = destelloRef.current;
    if (icono && numero && destello) acusarCambio(icono, numero, destello, cambio.sentido);
  }, [cambio]);

  /**
   * Al navegar se cierra: el header no se desmonta entre páginas, así que sin
   * esto el preview seguía abierto en /carrito o en el checkout.
   */
  const [pathAnterior, setPathAnterior] = useState(pathname);
  if (pathname !== pathAnterior) {
    setPathAnterior(pathname);
    setOpen(false);
  }

  /**
   * El hover abre sólo con mouse. En pantallas táctiles el toque emula un
   * `mouseenter` sin `mouseleave`, y el preview quedaba abierto hasta tocar
   * otra cosa.
   */
  function handlePointerEnter(e: PointerEvent) {
    if (e.pointerType !== "mouse") return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }

  function handlePointerLeave(e: PointerEvent) {
    if (e.pointerType !== "mouse") return;
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }

  return (
    <div
      className="relative"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      {/* Trigger: píldora de tinta con label + chip de count (el total vive
          dentro del popover, no en el header). */}
      <Link
        href="/carrito"
        className="flex items-center gap-2 rounded-full bg-primary px-[18px] py-[9px] text-sm font-semibold text-on-primary transition-colors hover:bg-accent hover:text-white"
      >
        <span ref={iconoRef} className="inline-flex">
          <CartIcon />
        </span>
        {/* En pantallas chicas queda sólo el ícono + la cantidad: la palabra
            mide 52px y es lo que hace que el carrito no entre al lado de la
            marca en la primera fila del header. El ícono ya dice qué es. */}
        <span className="max-sm:sr-only">Carrito</span>
        <span className="relative inline-flex h-5 min-w-5 items-center justify-center overflow-hidden rounded-full bg-white/20 text-[11px] font-extrabold">
          <span ref={destelloRef} aria-hidden className="absolute inset-0 bg-white/30 opacity-0" />
          <span ref={numeroRef} className="relative">
            {count}
          </span>
        </span>
      </Link>

      {/* Dropdown. Queda montado siempre para poder animar también el cierre:
          cerrado es `invisible` (fuera del árbol de accesibilidad y sin
          clicks), y `visibility` entra en la transición para que recién se
          oculte al terminar el fade. Crece desde la esquina del botón; con
          reduced motion sólo cambia la opacidad. */}
      <div
        className={`absolute right-0 top-full z-50 mt-3 w-80 origin-top-right overflow-hidden rounded-lg border border-border bg-surface shadow-lg transition-[opacity,scale,visibility] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:scale-100 ${
          open
            ? "visible scale-100 opacity-100 duration-[180ms]"
            : "pointer-events-none invisible scale-[0.96] opacity-0 duration-[120ms]"
        }`}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        {/* Puntero */}
        <div className="absolute -top-[7px] right-6 h-3 w-3 rotate-45 border-l border-t border-border bg-surface" />

        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <p className="text-sm font-medium text-text">El carrito está vacío</p>
            <Link href="/catalogo" className="text-xs font-semibold text-primary hover:underline">
              Ver catálogo
            </Link>
          </div>
        ) : (
          <>
            {/* Estructura de menú: el popover deja 8px (px-2) y la fila otros 8px
                (px-2), así la miniatura queda alineada a 16px con el título, el
                total y el botón. Radios concéntricos en tres niveles: popover
                rounded-lg, fila = lg − 8px, miniatura = lg − 16px. `scroll-fino`
                es la barra fina del DS. */}
            <div className="pt-4">
              <p className="mb-2 px-4 text-xs font-semibold uppercase tracking-wide text-muted">
                Carrito ({count} productos)
              </p>

              <ul className="scroll-fino max-h-72 space-y-0.5 overflow-y-auto px-2 pb-2">
                {items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/producto/${item.id}`}
                      className="flex items-center gap-3 rounded-[calc(var(--radius-lg)-0.5rem)] px-2 py-2 transition-colors hover:bg-elevated"
                    >
                      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[calc(var(--radius-lg)-1rem)] border border-border bg-surface text-muted/40">
                        {item.image ? (
                          <Image src={item.image} alt="" fill sizes="40px" className="object-contain p-0.5" />
                        ) : (
                          <LightbulbIcon />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-text">{nombreConMarca(item.name, item.brand ? formatMarca(item.brand) : undefined).nombre}</p>
                        <p className="text-xs text-muted">{item.qty} u. · {fmt(item.price)} c/u</p>
                      </div>
                      <p className="shrink-0 text-xs font-bold text-text">{fmt(item.price * item.qty)}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-t border-border px-4 py-3">
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="text-muted">Total</span>
                <span className="font-extrabold text-text">{fmt(total)}</span>
              </div>
              <Link href="/carrito" className="block">
                <Button className="w-full">Ver carrito</Button>
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
