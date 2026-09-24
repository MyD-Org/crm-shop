"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { useAuth } from "@clerk/nextjs";
import { useToast } from "@myd-org/ui";
import {
  actualizarQty,
  agregar,
  agregarVarios,
  CARRITO_VACIO,
  CLAVE_CACHE,
  itemsVisibles,
  type CacheCarrito,
  type CartItem,
} from "@/lib/carrito-cliente";
import { crearMotorCarrito, type MotorCarrito } from "@/lib/carrito-sync";

/**
 * Carrito del cliente.
 *
 * - Invitado o cookie del CRM sin Clerk: sólo local (localStorage), sin
 *   requests a /api/carrito.
 * - Con sesión de Clerk: el carrito vive en el servidor (`shop.carts`) y
 *   sigue al usuario entre dispositivos. localStorage queda como CACHÉ con
 *   dueño (`{ owner, version, items }`) para pintar al instante y sincronizar
 *   pestañas. Ver src/lib/carrito-sync.ts.
 *
 * Guarda `price`, `name` y `brand` SOLO para poder pintar la lista sin esperar
 * al servidor. El total que se cobra lo calcula /api/carrito/cotizar (ver
 * src/lib/cotizacion.ts). Lo único que el servidor toma de acá es `id` y `qty`.
 *
 * El estado vive FUERA de React y se lee con `useSyncExternalStore`: es la
 * forma correcta de consumir una fuente externa en React 19. Con `useState` +
 * efecto de hidratación, el HTML del servidor (carrito vacío) no coincide con
 * el primer render del cliente, y dos pestañas abiertas se pisan el carrito.
 */

export type { CartItem };

// --- Store ------------------------------------------------------------------

let motor: MotorCarrito | null = null;

/** Un motor por pestaña, creado recién en el navegador. */
function elMotor(): MotorCarrito {
  motor ??= crearMotorCarrito({
    leer: (k) => window.localStorage.getItem(k),
    escribir: (k, v) => window.localStorage.setItem(k, v),
    borrar: (k) => window.localStorage.removeItem(k),
    fetch: (...a) => window.fetch(...a),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id as number),
  });
  return motor;
}

const CACHE_SERVIDOR: CacheCarrito = { owner: null, version: null, items: CARRITO_VACIO };

/** En el servidor no hay carrito. Debe ser la MISMA referencia siempre. */
function getServerSnapshot(): CacheCarrito {
  return CACHE_SERVIDOR;
}

function getSnapshot(): CacheCarrito {
  return elMotor().leer();
}

function subscribe(onChange: () => void): () => void {
  const quitar = elMotor().subscribe(onChange);
  // El evento `storage` sólo dispara en las OTRAS pestañas: los cambios locales
  // los notifica el motor. Entre los dos, todas las pestañas quedan al día.
  function onStorage(e: StorageEvent) {
    if (e.key === CLAVE_CACHE) {
      elMotor().invalidar();
      onChange();
    }
  }
  window.addEventListener("storage", onStorage);
  return () => {
    quitar();
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Llamar ANTES de `clerk.signOut(...)`: sube lo pendiente como puede y deja el
 * carrito local vacío, para que el próximo que use el equipo no vea el carrito
 * de este usuario. El carrito del servidor queda intacto.
 */
export function prepararCierreDeSesion(): void {
  if (typeof window === "undefined") return;
  elMotor().prepararCierreDeSesion();
}

// --- Hook y provider --------------------------------------------------------

type ItemNuevo = Omit<CartItem, "qty">;

interface CartContextValue {
  items: CartItem[];
  addItem: (item: ItemNuevo, qty?: number) => void;
  /** Varias altas como UNA sola actualización (un solo guardado). */
  addItems: (lista: { item: ItemNuevo; qty: number }[]) => void;
  removeItem: (id: string) => void;
  updateQty: (id: string, qty: number) => void;
  clear: () => void;
  /** Tras crear un pedido: el servidor ya vació su carrito; sólo se limpia el local. */
  vaciarTrasPedido: () => void;
  /** Subtotal referencial. Para el número real, usar la cotización. */
  total: number;
  count: number;
  /** false durante el render del servidor y la hidratación. */
  ready: boolean;
  /**
   * Contador que sube con cada alta. El preview del header lo mira para
   * abrirse solo: es un contador y no un booleano para que dos altas seguidas
   * del mismo producto vuelvan a disparar el efecto.
   */
  aperturaPreview: number;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const cache = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // Truco estándar de hidratación: `true` en cliente, `false` en servidor. Sin
  // esto, el primer render pinta "carrito vacío" y parpadea al recargar.
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const { isLoaded, isSignedIn, userId } = useAuth();
  const usuario = isSignedIn && userId ? userId : null;
  const { toast } = useToast();
  const [aperturaPreview, setAperturaPreview] = useState(0);

  // Nunca mostrar el carrito de otro usuario (equipo compartido, sesión vencida).
  const items = itemsVisibles(cache, { isLoaded, usuario });

  useEffect(() => {
    elMotor().setAvisar(({ titulo, tono }) => toast({ title: titulo, tone: tono }));
  }, [toast]);

  // Al conocer (o cambiar) la sesión: descartar, mergear o traer del servidor.
  useEffect(() => {
    const m = elMotor();
    m.setSesion(isLoaded, usuario);
    m.reconciliar();
  }, [isLoaded, usuario]);

  // Al volver a la pestaña se trae lo del otro dispositivo (o se reintenta el
  // merge); al ocultarla o cerrarla se sube lo pendiente.
  useEffect(() => {
    const m = elMotor();
    function onVisibilidad() {
      if (document.visibilityState === "visible") m.reconciliar();
      else m.alOcultar();
    }
    const onPagehide = () => m.alOcultar();
    document.addEventListener("visibilitychange", onVisibilidad);
    window.addEventListener("pagehide", onPagehide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilidad);
      window.removeEventListener("pagehide", onPagehide);
    };
  }, []);

  const addItem = useCallback((newItem: ItemNuevo, qty = 1) => {
    // Última barrera: nada entra al carrito a $ 0 aunque algún botón lo intente.
    if (!(newItem.price > 0)) return;
    setAperturaPreview((n) => n + 1);
    elMotor().mutar((prev) => agregar(prev, newItem, qty));
  }, []);

  const addItems = useCallback((lista: { item: ItemNuevo; qty: number }[]) => {
    const validos = lista.filter((l) => l.item.price > 0);
    if (validos.length === 0) return;
    setAperturaPreview((n) => n + 1);
    elMotor().mutar((prev) => agregarVarios(prev, validos));
  }, []);

  const removeItem = useCallback((id: string) => {
    elMotor().mutar((prev) => actualizarQty(prev, id, 0));
  }, []);

  const updateQty = useCallback((id: string, qty: number) => {
    elMotor().mutar((prev) => actualizarQty(prev, id, qty));
  }, []);

  const clear = useCallback(() => {
    elMotor().mutar(() => ({ items: CARRITO_VACIO, avisos: [] }));
  }, []);

  const vaciarTrasPedido = useCallback(() => elMotor().vaciarTrasPedido(), []);

  const total = items.reduce((acc, i) => acc + i.price * i.qty, 0);
  const count = items.reduce((acc, i) => acc + i.qty, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        addItem,
        addItems,
        removeItem,
        updateQty,
        clear,
        vaciarTrasPedido,
        total,
        count,
        ready,
        aperturaPreview,
      }}
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
