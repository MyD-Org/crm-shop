"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth, useClerk } from "@clerk/nextjs";
import { useToast } from "@myd-org/ui";
import { destinoSeguro } from "@/lib/ingreso";
import {
  disponible as calcularDisponible,
  mensajeError,
  reducirToggle,
  revertir,
} from "@/lib/favoritos-cliente";

/**
 * Favoritos del usuario de Clerk, con la fuente en el servidor
 * (`/api/mi-cuenta/favoritos`). Un solo GET al montar con sesión; cada toggle
 * es optimista y se revierte con un toast si la API no guarda.
 *
 * Antes de `ready` el corazón se ve neutro y no hace nada: el HTML del servidor
 * (sin favoritos) coincide con el primer render del cliente.
 */

const API = "/api/mi-cuenta/favoritos";

/** Constante estable: un `Set` nuevo en cada render cambiaría el contexto. */
const VACIO: ReadonlySet<string> = new Set();

interface FavoritosValue {
  /** Ya se sabe qué está guardado (o no hay sesión y Clerk terminó de cargar). */
  ready: boolean;
  /** Se muestra el corazón (no, para la cookie del CRM sin Clerk). */
  disponible: boolean;
  /** Filas del usuario (incluye ítems que ya no están en el catálogo). */
  count: number;
  esFavorito: (id: string) => boolean;
  toggle: (id: string) => Promise<void>;
}

const FavoritosContext = createContext<FavoritosValue | null>(null);

/** Setter del bloqueo: lo usa `BloquearFavoritos` (ver abajo). */
const BloqueoContext = createContext<(bloqueados: boolean) => void>(() => {});

export function FavoritosProvider({ children }: { children: ReactNode }) {
  // La identidad es la cookie del CRM sin Clerk: no hay dónde guardar. Arranca
  // en false (el shell es el mismo para todos) y lo prende `BloquearFavoritos`,
  // que monta el hueco `BloqueoFavoritos` del layout sólo en ese caso.
  const [favoritosBloqueados, setFavoritosBloqueados] = useState(false);
  const { isLoaded, isSignedIn, userId } = useAuth();
  const clerk = useClerk();
  const { toast } = useToast();

  // Ids cargados, atados al usuario al que pertenecen: si cambia la sesión, el
  // estado viejo deja de valer sin tener que limpiarlo a mano.
  const [cargado, setCargado] = useState<{ usuario: string; ids: ReadonlySet<string> } | null>(null);
  const enVuelo = useRef(new Set<string>());

  const usuario = isSignedIn && userId ? userId : null;

  useEffect(() => {
    if (!usuario) return;
    let vigente = true;
    fetch(API, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body: { ids?: unknown }) =>
        Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [],
      )
      .catch((err: unknown) => {
        // Sin toast: el visitante no pidió nada todavía. Los corazones quedan vacíos.
        console.error("[favoritos] no se pudieron cargar", err);
        return [] as string[];
      })
      .then((ids) => {
        if (vigente) setCargado({ usuario, ids: new Set(ids) });
      });
    return () => {
      vigente = false;
    };
  }, [usuario]);

  const ids = usuario && cargado?.usuario === usuario ? cargado.ids : VACIO;
  const ready = usuario ? cargado?.usuario === usuario : isLoaded;
  const disponible = calcularDisponible({ isSignedIn, favoritosBloqueados });

  // La ruta se lee del navegador al abrir (sólo pasa con un clic): con
  // `usePathname` este provider, que envuelve todo el layout, suspendería el
  // prerender de las rutas con parámetros (ficha, pedido).
  const abrirIngreso = useCallback(() => {
    const destino = destinoSeguro(window.location.pathname);
    clerk.openSignIn({ fallbackRedirectUrl: destino, signUpFallbackRedirectUrl: destino });
  }, [clerk]);

  /** Aplica un cambio sobre los ids del usuario vigente (y sólo de él). */
  const actualizar = useCallback(
    (cambio: (ids: ReadonlySet<string>) => Set<string>) =>
      setCargado((prev) =>
        prev && prev.usuario === usuario ? { usuario: prev.usuario, ids: cambio(prev.ids) } : prev,
      ),
    [usuario],
  );

  const toggle = useCallback(
    async (id: string) => {
      if (!ready) return;
      if (!usuario) {
        // Anónimo: el corazón invita a ingresar; no se llama a la API ni se
        // recuerda el intento (sin merge de favoritos anónimos).
        abrirIngreso();
        return;
      }
      // Un segundo clic mientras viaja el primero se ignora.
      if (enVuelo.current.has(id)) return;
      enVuelo.current.add(id);

      const { metodo } = reducirToggle(ids, id);
      actualizar((s) => reducirToggle(s, id).siguiente);

      let status = 0;
      let body: { error?: unknown } | null = null;
      try {
        const res = await fetch(API, {
          method: metodo,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ alegraItemId: id }),
        });
        if (res.ok) return;
        status = res.status;
        body = await res.json().catch(() => null);
      } catch {
        // Error de red: status 0.
      } finally {
        enVuelo.current.delete(id);
      }

      actualizar((s) => revertir(s, id, metodo));
      if (status === 401) {
        // La sesión venció en el medio: que vuelva a ingresar.
        abrirIngreso();
        return;
      }
      toast({ title: mensajeError(status, body), tone: "danger" });
    },
    [ready, usuario, ids, abrirIngreso, actualizar, toast],
  );

  const value = useMemo<FavoritosValue>(
    () => ({
      ready,
      disponible,
      count: ids.size,
      esFavorito: (id: string) => ids.has(id),
      toggle,
    }),
    [ready, disponible, ids, toggle],
  );

  return (
    <BloqueoContext.Provider value={setFavoritosBloqueados}>
      <FavoritosContext.Provider value={value}>{children}</FavoritosContext.Provider>
    </BloqueoContext.Provider>
  );
}

/**
 * Marca los favoritos como bloqueados mientras está montado (cookie del CRM
 * sin Clerk). Sólo lo renderiza el hueco server `BloqueoFavoritos`.
 */
export function BloquearFavoritos() {
  const setBloqueados = useContext(BloqueoContext);
  useLayoutEffect(() => {
    setBloqueados(true);
    return () => setBloqueados(false);
  }, [setBloqueados]);
  return null;
}

export function useFavoritos() {
  const ctx = useContext(FavoritosContext);
  if (!ctx) throw new Error("useFavoritos must be used inside FavoritosProvider");
  return ctx;
}
