/**
 * Motor del carrito en el navegador: caché local (`centralled.carrito.v2`) y
 * sincronización con /api/carrito para usuarios de Clerk.
 *
 * Vive fuera de React (CartContext lo consume con `useSyncExternalStore`) y
 * recibe storage, fetch y timers por parámetro para poder testearlo en node
 * sin DOM. Las reglas de negocio (normalizar, merge, visibilidad) están en
 * `carrito-cliente.ts`; acá sólo se decide CUÁNDO leer y escribir.
 *
 * Reglas que sostiene:
 * - Sin sesión de Clerk (invitado o cookie del CRM) no hay requests: carrito
 *   sólo local con `owner: null`.
 * - Nunca se sube ni se muestra el carrito de otro: antes de cada escritura se
 *   vuelve a chequear que el dueño de la caché sea el usuario de la sesión.
 * - Ráfagas de cambios → un solo PUT (debounce), una escritura en vuelo por
 *   pestaña. 409 → se adopta el carrito del servidor.
 * - Las respuestas de una "generación" vieja (cambió el usuario, se vació tras
 *   un pedido, se cerró sesión) se descartan.
 */
import {
  aLineas,
  accionAlCargar,
  CARRITO_VACIO,
  CLAVE_CACHE,
  CLAVE_CACHE_V1,
  COPY_CARRITO,
  contenidoDistinto,
  mensajeAviso,
  mergeMax,
  parsearCache,
  parsearItems,
  validarVersion,
  type AvisoCarrito,
  type CacheCarrito,
  type CartItem,
} from "./carrito-cliente";

export const API_CARRITO = "/api/carrito";
/** Espera desde el último cambio antes del PUT (más que los 350 ms de la cotización). */
export const DEBOUNCE_MS = 600;

export type Notificacion = { titulo: string; tono: "neutral" | "warning" | "danger" };

export interface EntornoCarrito {
  /** Puede tirar (storage bloqueado): el motor sigue en memoria. */
  leer(clave: string): string | null;
  escribir(clave: string, valor: string): void;
  borrar(clave: string): void;
  fetch: typeof fetch;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

type Sesion = { isLoaded: boolean; usuario: string | null };

const CACHE_VACIA: CacheCarrito = { owner: null, version: null, items: CARRITO_VACIO };

type Respuesta = { status: number; body: Record<string, unknown> | null } | null;

export function crearMotorCarrito(env: EntornoCarrito) {
  const listeners = new Set<() => void>();
  /** undefined = hay que releer el storage. */
  let raw: string | null | undefined = undefined;
  let snapshot: CacheCarrito = CACHE_VACIA;
  /** true si el storage está bloqueado (modo privado): se sigue en memoria. */
  let memoriaSolo = false;
  let migradoV1 = false;

  let sesion: Sesion = { isLoaded: false, usuario: null };
  /** Sube cuando lo que esté en vuelo deja de valer. */
  let generacion = 0;
  /** Generación de la request en vuelo, o null. Una por pestaña. */
  let enVuelo: number | null = null;
  /** Hay un cambio local del usuario que el servidor todavía no tiene. */
  let pendiente = false;
  /** Se está cerrando la sesión: no sincronizar hasta que Clerk la cierre. */
  let cerrando = false;
  let fallosSeguidos = 0;
  let timer: unknown = null;
  let avisar: (n: Notificacion) => void = () => {};

  const ocupado = () => enVuelo === generacion;

  // --- Caché -----------------------------------------------------------------

  function guardar(c: CacheCarrito, notificar = true) {
    const texto = JSON.stringify(c);
    if (!memoriaSolo) {
      try {
        env.escribir(CLAVE_CACHE, texto);
        raw = texto;
      } catch {
        // Storage lleno o bloqueado: el carrito sigue andando, sólo no
        // sobrevive al reload. Preferible a romper la compra.
        memoriaSolo = true;
      }
    }
    snapshot = c;
    if (notificar) for (const l of listeners) l();
  }

  /**
   * Snapshot cacheado por el string crudo: `useSyncExternalStore` compara por
   * identidad, así que no se puede devolver un objeto nuevo en cada llamada.
   */
  function leer(): CacheCarrito {
    if (memoriaSolo) return snapshot;
    let rawV2: string | null;
    try {
      rawV2 = env.leer(CLAVE_CACHE);
    } catch {
      memoriaSolo = true;
      return snapshot;
    }
    if (rawV2 === null && !migradoV1) {
      // Carrito de antes del cambio (v1, sin dueño): se adopta como invitado.
      migradoV1 = true;
      let rawV1: string | null = null;
      try {
        rawV1 = env.leer(CLAVE_CACHE_V1);
      } catch {
        rawV1 = null;
      }
      if (rawV1 !== null) {
        guardar(parsearCache(null, rawV1), false);
        try {
          env.borrar(CLAVE_CACHE_V1);
        } catch {
          // Sin storage no hay nada que borrar.
        }
        return snapshot;
      }
    }
    if (rawV2 !== raw) {
      raw = rawV2;
      snapshot = rawV2 === null ? CACHE_VACIA : parsearCache(rawV2, null);
    }
    return snapshot;
  }

  // --- Red -------------------------------------------------------------------

  async function pedir(init: RequestInit & { method: string }): Promise<Respuesta> {
    try {
      const res = await env.fetch(API_CARRITO, {
        cache: "no-store",
        ...init,
        headers: init.body ? { "content-type": "application/json" } : undefined,
      });
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      return { status: res.status, body };
    } catch {
      return null;
    }
  }

  /** `{ items, version }` válidos de una respuesta, o null. */
  function carritoDe(body: Record<string, unknown> | null) {
    const items = parsearItems(body?.items);
    const version = validarVersion(body?.version);
    return items && version !== null ? { items, version } : null;
  }

  function avisarTodos(avisos: unknown) {
    if (!Array.isArray(avisos)) return;
    for (const a of new Set(avisos)) {
      if (a === "lineas" || a === "cantidad") {
        avisar({ titulo: mensajeAviso(a as AvisoCarrito), tono: "warning" });
      }
    }
  }

  function fallo() {
    fallosSeguidos++;
    // Un corte suelto no amerita aviso: se reintenta en el próximo cambio o al
    // volver a la pestaña. Si se repite, que el cliente sepa.
    if (fallosSeguidos === 2) avisar({ titulo: COPY_CARRITO.errorGuardar, tono: "danger" });
  }

  function cancelarTimer() {
    if (timer !== null) env.clearTimeout(timer);
    timer = null;
  }

  function programar(ms = DEBOUNCE_MS) {
    cancelarTimer();
    timer = env.setTimeout(() => {
      timer = null;
      void sincronizar();
    }, ms);
  }

  const usuarioActivo = () => (sesion.isLoaded && !cerrando ? sesion.usuario : null);

  /** Sube el cambio pendiente (o reintenta el merge del invitado). */
  async function sincronizar(opts: { keepalive?: boolean } = {}): Promise<void> {
    const u = usuarioActivo();
    if (!u) return;
    const c = leer();
    if (c.owner === null) {
      // Caché de invitado con sesión: falta (o falló) el merge. En un cierre
      // de pestaña no se intenta: sin respuesta, el merge no sirve.
      if (c.items.length > 0 && !opts.keepalive) await merge();
      return;
    }
    if (c.owner !== u) {
      pendiente = false;
      return;
    }
    if (!pendiente) return;
    if (c.version === null) {
      // Todavía no se sabe la versión del servidor: el GET une y reprograma.
      if (!opts.keepalive) await refrescar();
      return;
    }
    await subir(c, u, opts.keepalive ?? false);
  }

  async function subir(c: CacheCarrito, u: string, keepalive: boolean) {
    if (ocupado()) return; // Al volver la que está en vuelo, se reprograma.
    cancelarTimer();
    pendiente = false;
    const gen = generacion;
    enVuelo = gen;
    const enviado = aLineas(c.items);
    const r = await pedir({
      method: "PUT",
      body: JSON.stringify({ version: c.version, items: enviado }),
      keepalive,
    });
    if (enVuelo === gen) enVuelo = null;
    if (gen !== generacion) return;

    if (!r || r.status === 429 || r.status >= 500) {
      pendiente = true;
      fallo();
      return;
    }
    if (r.status === 401) return; // La sesión venció: la reconciliación limpia.
    const servidor = carritoDe(r.body);
    if (r.status === 400 || !servidor) {
      avisar({ titulo: COPY_CARRITO.errorGuardar, tono: "danger" });
      return;
    }
    fallosSeguidos = 0;
    const actual = leer();
    if (actual.owner !== u) return;

    if (r.status === 409) {
      // Otro dispositivo escribió antes: gana el servidor, sin reintentar.
      pendiente = false;
      cancelarTimer();
      if (contenidoDistinto(actual.items, servidor.items)) {
        avisar({ titulo: COPY_CARRITO.otroDispositivo, tono: "neutral" });
      }
      guardar({ owner: u, ...servidor });
      return;
    }

    avisarTodos(r.body?.avisos);
    if (pendiente) {
      // Hubo cambios mientras volaba: se conservan y se suben con la versión nueva.
      guardar({ ...actual, version: servidor.version });
      programar();
    } else {
      guardar({ owner: u, ...servidor });
    }
  }

  /** Trae el carrito del servidor y lo adopta. */
  async function refrescar(): Promise<void> {
    const u = usuarioActivo();
    if (!u || ocupado()) return;
    const antes = leer();
    // Con un cambio pendiente sobre una versión conocida, el PUT decide (y un
    // 409 adopta el servidor). Pedir acá pisaría el cambio.
    if (pendiente && antes.version !== null) return;
    const gen = generacion;
    enVuelo = gen;
    const r = await pedir({ method: "GET" });
    if (enVuelo === gen) enVuelo = null;
    if (gen !== generacion || !r || r.status !== 200) return;
    const servidor = carritoDe(r.body);
    if (!servidor) return;

    const c = leer();
    if (c.owner === null && c.items.length > 0) {
      // Se agregó algo como invitado mientras volaba: eso es un merge.
      await merge();
      return;
    }
    if (c.owner !== null && c.owner !== u) return;
    if (pendiente) {
      // Cambios hechos antes de conocer la versión (tras descartar o vaciar):
      // se unen con el servidor por máximo, sin perder ninguno de los dos.
      const porId = new Map<string, CartItem>(
        [...servidor.items, ...c.items].map((i) => [i.id, i]),
      );
      const unidos = mergeMax(servidor.items, c.items).items.map((l) => ({
        ...porId.get(l.id)!,
        qty: l.qty,
      }));
      guardar({ owner: u, version: servidor.version, items: unidos });
      programar();
      return;
    }
    guardar({ owner: u, ...servidor });
  }

  /** Une el carrito de invitado con el del usuario que acaba de ingresar. */
  async function merge(): Promise<void> {
    const u = usuarioActivo();
    if (!u || ocupado()) return;
    const c = leer();
    if (c.owner !== null || c.items.length === 0) return;
    const gen = generacion;
    enVuelo = gen;
    const enviado = aLineas(c.items);
    const r = await pedir({ method: "POST", body: JSON.stringify({ items: enviado }) });
    if (enVuelo === gen) enVuelo = null;
    if (gen !== generacion) return;
    if (!r || r.status === 429 || r.status >= 500) {
      // La caché queda de invitado: se reintenta al volver a la pestaña, al
      // montar o con el próximo cambio.
      fallo();
      return;
    }
    const servidor = r.status === 200 ? carritoDe(r.body) : null;
    if (!servidor) return;
    fallosSeguidos = 0;
    avisarTodos(r.body?.avisos);

    const actual = leer();
    if (actual.owner !== null) return; // Otra pestaña ya lo resolvió.
    if (contenidoDistinto(enviado, actual.items)) {
      // El invitado siguió cambiando: el merge por máximo es idempotente, se repite.
      await merge();
      return;
    }
    guardar({ owner: u, ...servidor });
  }

  // --- API del motor ---------------------------------------------------------

  /** Aplica un cambio local sobre el carrito visible y agenda la subida. */
  function mutar(fn: (items: CartItem[]) => { items: CartItem[]; avisos: AvisoCarrito[] }) {
    const c = leer();
    const propio = c.owner !== null && sesion.isLoaded && c.owner === sesion.usuario;
    // Una caché ajena nunca es base del cambio: se arranca de cero como invitado.
    const base = c.owner === null || propio ? c.items : CARRITO_VACIO;
    const owner = propio ? c.owner : null;
    const r = fn(base);
    for (const a of r.avisos) avisar({ titulo: mensajeAviso(a), tono: "warning" });
    if (r.items === base) return;
    guardar({ owner, version: owner === null ? null : c.version, items: r.items });
    if (owner !== null) pendiente = true;
    if (usuarioActivo()) programar();
  }

  /** Tras crear un pedido: el servidor ya vació su carrito en la misma transacción. */
  function vaciarTrasPedido() {
    generacion++;
    cancelarTimer();
    pendiente = false;
    const c = leer();
    // Versión desconocida: el GET trae la que dejó el pedido.
    guardar({ owner: c.owner, version: null, items: CARRITO_VACIO });
    if (c.owner !== null && c.owner === usuarioActivo()) void refrescar();
  }

  /**
   * Antes de cerrar sesión: sube lo pendiente como puede (keepalive, sin
   * esperar) y deja la caché vacía de invitado. El carrito del servidor queda
   * intacto y reaparece al volver a ingresar.
   */
  function prepararCierreDeSesion() {
    const c = leer();
    const u = usuarioActivo();
    if (pendiente && u && c.owner === u && c.version !== null) {
      void pedir({
        method: "PUT",
        body: JSON.stringify({ version: c.version, items: aLineas(c.items) }),
        keepalive: true,
      });
    }
    generacion++;
    cancelarTimer();
    pendiente = false;
    cerrando = true;
    guardar({ owner: null, version: null, items: CARRITO_VACIO });
  }

  /** Qué hacer con la caché al conocer (o cambiar) la sesión, o al volver a la pestaña. */
  function reconciliar() {
    const c = leer();
    switch (accionAlCargar(c, sesion.usuario, sesion.isLoaded)) {
      case "descartar":
        // Caché de otro usuario (o de una sesión que ya no está): no se
        // muestra, no se mergea y no se sube.
        pendiente = false;
        cancelarTimer();
        guardar({ owner: sesion.usuario, version: null, items: CARRITO_VACIO });
        if (usuarioActivo()) void refrescar();
        break;
      case "merge":
        void merge();
        break;
      case "refrescar":
        if (pendiente) void sincronizar();
        else void refrescar();
        break;
      default:
        break;
    }
  }

  function setSesion(isLoaded: boolean, usuario: string | null) {
    if (usuario !== sesion.usuario) {
      generacion++;
      cancelarTimer();
      pendiente = false;
      cerrando = false;
      fallosSeguidos = 0;
    }
    sesion = { isLoaded, usuario };
  }

  return {
    leer,
    /** Otra pestaña cambió el storage: releer en el próximo snapshot. */
    invalidar() {
      raw = undefined;
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    setAvisar(fn: (n: Notificacion) => void) {
      avisar = fn;
    },
    setSesion,
    reconciliar,
    mutar,
    vaciarTrasPedido,
    prepararCierreDeSesion,
    /** Al ocultar o cerrar la pestaña. */
    alOcultar() {
      void sincronizar({ keepalive: true });
    },
  };
}

export type MotorCarrito = ReturnType<typeof crearMotorCarrito>;
