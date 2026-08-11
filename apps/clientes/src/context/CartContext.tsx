"use client";

import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

/**
 * Carrito del cliente, persistido en localStorage.
 *
 * Guarda `price`, `name` y `brand` SOLO para poder pintar la lista sin esperar
 * al servidor. Esos valores no valen nada: el total que se cobra lo calcula
 * /api/carrito/cotizar leyendo Alegra en vivo (ver src/lib/cotizacion.ts). Lo
 * único que el servidor toma de acá es `id` y `qty`.
 *
 * El estado vive FUERA de React, en localStorage, y se lee con
 * `useSyncExternalStore`. No es sofisticación gratuita: es la forma correcta de
 * consumir una fuente externa en React 19. Con `useState` + efecto de
 * hidratación, el HTML del servidor (carrito vacío) no coincide con el primer
 * render del cliente, y encima dos pestañas abiertas se pisan el carrito.
 */

export interface CartItem {
  id: string;
  name: string;
  brand: string;
  variant?: string;
  /** Referencial, para mostrar mientras llega la cotización real. */
  price: number;
  qty: number;
}

const STORAGE_KEY = "centralled.carrito.v1";
/** Tope duro de unidades por línea. Coincide con QTY_MAX del servidor. */
const QTY_MAX = 9_999;

/** Constante estable: devolver `[]` nuevo en cada snapshot es un loop infinito. */
const VACIO: CartItem[] = [];

// --- Store ------------------------------------------------------------------

const listeners = new Set<() => void>();
let rawCache: string | null = null;
let snapshotCache: CartItem[] = VACIO;
/** true si el storage está bloqueado (modo privado): se sigue en memoria. */
let memoriaSolo = false;

/**
 * Valida item por item: el storage es editable por el usuario y sobrevive a
 * deploys, así que puede tener la forma de una versión anterior del carrito.
 */
function parsear(raw: string | null): CartItem[] {
  if (!raw) return VACIO;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return VACIO;
    return parsed.flatMap((i): CartItem[] => {
      const item = i as Partial<CartItem>;
      const qty = Math.floor(Number(item?.qty));
      if (!item?.id || !Number.isFinite(qty) || qty <= 0) return [];
      return [
        {
          id: String(item.id),
          name: String(item.name ?? ""),
          brand: String(item.brand ?? ""),
          variant: item.variant ? String(item.variant) : undefined,
          price: Number(item.price) || 0,
          qty: Math.min(qty, QTY_MAX),
        },
      ];
    });
  } catch {
    return VACIO;
  }
}

/**
 * Snapshot cacheado por el string crudo. `useSyncExternalStore` compara por
 * identidad: si acá se parseara el JSON en cada llamada, cada render devolvería
 * un array nuevo y React entraría en bucle.
 */
function getSnapshot(): CartItem[] {
  if (memoriaSolo) return snapshotCache;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    memoriaSolo = true;
    return snapshotCache;
  }
  if (raw !== rawCache) {
    rawCache = raw;
    snapshotCache = parsear(raw);
  }
  return snapshotCache;
}

/** En el servidor no hay carrito. Debe ser la MISMA referencia siempre. */
function getServerSnapshot(): CartItem[] {
  return VACIO;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // El evento `storage` solo dispara en las OTRAS pestañas: los cambios locales
  // los notifica `escribir`. Entre los dos, todas las pestañas quedan al día.
  function onStorage(e: StorageEvent) {
    if (e.key === STORAGE_KEY) {
      rawCache = null;
      onChange();
    }
  }
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function escribir(next: CartItem[]) {
  const raw = JSON.stringify(next);
  try {
    window.localStorage.setItem(STORAGE_KEY, raw);
    rawCache = raw;
  } catch {
    // Storage lleno o bloqueado: el carrito sigue andando, solo no sobrevive
    // al reload. Preferible a romper la compra.
    memoriaSolo = true;
  }
  snapshotCache = next;
  for (const l of listeners) l();
}

function actualizar(fn: (prev: CartItem[]) => CartItem[]) {
  escribir(fn(getSnapshot()));
}

// --- Hook y provider --------------------------------------------------------

interface CartContextValue {
  items: CartItem[];
  addItem: (item: Omit<CartItem, "qty">, qty?: number) => void;
  removeItem: (id: string) => void;
  updateQty: (id: string, qty: number) => void;
  clear: () => void;
  /** Subtotal referencial. Para el número real, usar la cotización. */
  total: number;
  count: number;
  /** false durante el render del servidor y la hidratación. */
  ready: boolean;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // Truco estándar de hidratación: `true` en cliente, `false` en servidor. Sin
  // esto, el primer render pinta "tu carrito está vacío" y parpadea al recargar.
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const addItem = useCallback((newItem: Omit<CartItem, "qty">, qty = 1) => {
    actualizar((prev) => {
      const existing = prev.find((i) => i.id === newItem.id);
      if (existing) {
        return prev.map((i) =>
          i.id === newItem.id
            ? { ...i, ...newItem, qty: Math.min(i.qty + qty, QTY_MAX) }
            : i,
        );
      }
      return [...prev, { ...newItem, qty: Math.min(qty, QTY_MAX) }];
    });
  }, []);

  const removeItem = useCallback((id: string) => {
    actualizar((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const updateQty = useCallback((id: string, qty: number) => {
    actualizar((prev) =>
      qty <= 0
        ? prev.filter((i) => i.id !== id)
        : prev.map((i) => (i.id === id ? { ...i, qty: Math.min(qty, QTY_MAX) } : i)),
    );
  }, []);

  const clear = useCallback(() => escribir(VACIO), []);

  const total = items.reduce((acc, i) => acc + i.price * i.qty, 0);
  const count = items.reduce((acc, i) => acc + i.qty, 0);

  return (
    <CartContext.Provider
      value={{ items, addItem, removeItem, updateQty, clear, total, count, ready }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
