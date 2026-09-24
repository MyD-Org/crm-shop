import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agregar, agregarVarios, actualizarQty, CLAVE_CACHE, CLAVE_CACHE_V1, type CartItem } from "./carrito-cliente";
import { crearMotorCarrito, DEBOUNCE_MS, type Notificacion } from "./carrito-sync";

/**
 * Motor del carrito sin DOM: storage en un Map, fetch grabado y timers falsos.
 * Cubre los escenarios del spec que dependen de CUÁNDO se habla con el
 * servidor (la forma del carrito está en carrito-cliente.test.ts).
 */

type Llamada = { method: string; body: unknown; keepalive?: boolean };

let storage: Map<string, string>;
let llamadas: Llamada[];
let respuestas: Array<() => Promise<Response>>;
let avisos: Notificacion[];

const responder = (status: number, body: unknown) => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const sinRed = () => () => Promise.reject(new TypeError("Failed to fetch"));

/** Respuesta que se resuelve a mano, para simular una request en vuelo. */
function diferida() {
  let resolver!: (r: Response) => void;
  const p = new Promise<Response>((r) => (resolver = r));
  return {
    fn: () => p,
    resolver: (status: number, body: unknown) =>
      resolver(new Response(JSON.stringify(body), { status })),
  };
}

function crear() {
  const motor = crearMotorCarrito({
    leer: (k) => storage.get(k) ?? null,
    escribir: (k, v) => void storage.set(k, v),
    borrar: (k) => void storage.delete(k),
    fetch: (async (_url: string, init?: RequestInit) => {
      llamadas.push({
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        keepalive: init?.keepalive,
      });
      const r = respuestas.shift();
      if (!r) throw new Error("fetch sin respuesta preparada");
      return r();
    }) as typeof fetch,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  });
  motor.setAvisar((n) => avisos.push(n));
  return motor;
}

const prod = (id: string, price = 100): Omit<CartItem, "qty"> => ({ id, name: `P${id}`, brand: "M", price });
const item = (id: string, qty: number): CartItem => ({ ...prod(id), qty });
const cache = (owner: string | null, version: number | null, items: CartItem[]) =>
  storage.set(CLAVE_CACHE, JSON.stringify({ owner, version, items }));
const lineas = (m: ReturnType<typeof crear>) => m.leer().items.map((i) => [i.id, i.qty]);

/** Deja correr promesas y timers pendientes. */
async function drenar(ms = DEBOUNCE_MS) {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  storage = new Map();
  llamadas = [];
  respuestas = [];
  avisos = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("caché local", () => {
  it("adopta el carrito v1 como invitado y borra la clave vieja", () => {
    storage.set(CLAVE_CACHE_V1, JSON.stringify([item("1", 2)]));
    const m = crear();
    expect(m.leer()).toEqual({ owner: null, version: null, items: [item("1", 2)] });
    expect(storage.has(CLAVE_CACHE_V1)).toBe(false);
    expect(JSON.parse(storage.get(CLAVE_CACHE)!).owner).toBeNull();
  });

  it("el snapshot es estable mientras el storage no cambia", () => {
    cache(null, null, [item("1", 1)]);
    const m = crear();
    expect(m.leer()).toBe(m.leer());
  });
});

describe("invitado y cookie del CRM", () => {
  it("agregar y quitar no hace ninguna request", async () => {
    const m = crear();
    m.setSesion(true, null);
    m.reconciliar();
    m.mutar((items) => agregar(items, prod("1"), 2));
    m.mutar((items) => actualizarQty(items, "1", 0));
    m.mutar((items) => agregar(items, prod("2")));
    m.alOcultar();
    await drenar(5_000);
    expect(llamadas).toEqual([]);
    expect(m.leer()).toEqual({ owner: null, version: null, items: [item("2", 1)] });
  });
});

describe("modo sincronizado", () => {
  it("una ráfaga del stepper produce un solo PUT con la cantidad final", async () => {
    cache("u1", 3, [item("1", 1)]);
    const m = crear();
    m.setSesion(true, "u1");
    for (let q = 2; q <= 6; q++) m.mutar((items) => actualizarQty(items, "1", q));
    respuestas.push(responder(200, { items: [item("1", 6)], version: 4, avisos: [] }));
    await drenar();
    expect(llamadas).toEqual([
      { method: "PUT", body: { version: 3, items: [{ id: "1", qty: 6 }] }, keepalive: false },
    ]);
    expect(m.leer().version).toBe(4);
  });

  it("repetir pedido (agregarVarios) es un solo PUT", async () => {
    cache("u1", 1, []);
    const m = crear();
    m.setSesion(true, "u1");
    m.mutar((items) =>
      agregarVarios(items, Array.from({ length: 8 }, (_, i) => ({ item: prod(String(i + 1)), qty: 1 }))),
    );
    respuestas.push(responder(200, { items: [], version: 2, avisos: [] }));
    await drenar();
    expect(llamadas.filter((l) => l.method === "PUT")).toHaveLength(1);
    expect((llamadas[0].body as { items: unknown[] }).items).toHaveLength(8);
  });

  it("409: adopta el carrito del servidor y avisa sólo si cambió el contenido", async () => {
    cache("u1", 3, [item("1", 1)]);
    const m = crear();
    m.setSesion(true, "u1");
    m.mutar((items) => agregar(items, prod("2")));
    respuestas.push(responder(409, { error: "x", items: [item("9", 4)], version: 7 }));
    await drenar();
    expect(m.leer()).toEqual({ owner: "u1", version: 7, items: [item("9", 4)] });
    expect(avisos).toEqual([{ titulo: "Su carrito se actualizó desde otro dispositivo.", tono: "neutral" }]);

    // Mismo contenido que el local → sin aviso.
    avisos = [];
    m.mutar((items) => actualizarQty(items, "9", 5));
    respuestas.push(responder(409, { error: "x", items: [item("9", 5)], version: 9 }));
    await drenar();
    expect(avisos).toEqual([]);
    expect(m.leer().version).toBe(9);
  });

  it("error de red: conserva el cambio local y lo reintenta con el próximo cambio", async () => {
    cache("u1", 3, [item("1", 1)]);
    const m = crear();
    m.setSesion(true, "u1");
    m.mutar((items) => actualizarQty(items, "1", 2));
    respuestas.push(sinRed());
    await drenar();
    expect(lineas(m)).toEqual([["1", 2]]);

    m.mutar((items) => agregar(items, prod("2")));
    respuestas.push(responder(200, { items: [item("1", 2), item("2", 1)], version: 4, avisos: [] }));
    await drenar();
    expect(llamadas).toHaveLength(2);
    expect(llamadas[1].body).toEqual({
      version: 3,
      items: [
        { id: "1", qty: 2 },
        { id: "2", qty: 1 },
      ],
    });
    // Un solo fallo no avisa.
    expect(avisos).toEqual([]);
  });

  it("cambios mientras vuela el PUT se suben después con la versión nueva", async () => {
    cache("u1", 3, [item("1", 1)]);
    const m = crear();
    m.setSesion(true, "u1");
    const primero = diferida();
    respuestas.push(primero.fn);
    m.mutar((items) => actualizarQty(items, "1", 2));
    await drenar();
    m.mutar((items) => actualizarQty(items, "1", 3));
    await drenar(); // El timer dispara pero hay uno en vuelo: no sale otro PUT.
    expect(llamadas).toHaveLength(1);

    respuestas.push(responder(200, { items: [item("1", 3)], version: 5, avisos: [] }));
    primero.resolver(200, { items: [item("1", 2)], version: 4, avisos: [] });
    await drenar();
    expect(llamadas).toHaveLength(2);
    expect(llamadas[1].body).toEqual({ version: 4, items: [{ id: "1", qty: 3 }] });
    expect(m.leer()).toMatchObject({ version: 5, items: [item("1", 3)] });
  });

  it("no sube si el dueño de la caché ya no es el usuario de la sesión", async () => {
    cache("u1", 3, [item("1", 1)]);
    const m = crear();
    m.setSesion(true, "u1");
    m.mutar((items) => agregar(items, prod("2")));
    m.setSesion(true, "u2");
    await drenar();
    expect(llamadas).toEqual([]);
  });

  it("al ocultar la pestaña sube lo pendiente con keepalive", async () => {
    cache("u1", 3, [item("1", 1)]);
    const m = crear();
    m.setSesion(true, "u1");
    m.mutar((items) => actualizarQty(items, "1", 2));
    respuestas.push(responder(200, { items: [item("1", 2)], version: 4, avisos: [] }));
    m.alOcultar();
    await drenar(0);
    expect(llamadas).toEqual([
      { method: "PUT", body: { version: 3, items: [{ id: "1", qty: 2 }] }, keepalive: true },
    ]);
    await drenar();
    expect(llamadas).toHaveLength(1);
  });

  it("los topes locales avisan en usted", () => {
    const m = crear();
    m.setSesion(true, null);
    m.mutar((items) => agregar(items, prod("1"), 20_000));
    expect(avisos).toEqual([{ titulo: "Se ajustó la cantidad al máximo permitido.", tono: "warning" }]);
  });
});

describe("al cargar la sesión", () => {
  it("con caché propia trae el carrito del servidor (otro dispositivo)", async () => {
    cache("u1", 1, [item("1", 1)]);
    const m = crear();
    m.setSesion(true, "u1");
    respuestas.push(responder(200, { items: [item("1", 2)], version: 2 }));
    m.reconciliar();
    await drenar(0);
    expect(llamadas.map((l) => l.method)).toEqual(["GET"]);
    expect(m.leer()).toEqual({ owner: "u1", version: 2, items: [item("1", 2)] });
  });

  it("invitado que ingresa: merge y la caché pasa a ser del usuario", async () => {
    cache(null, null, [item("1", 5), item("3", 3)]);
    const m = crear();
    m.setSesion(true, "u1");
    respuestas.push(
      responder(200, { items: [item("1", 5), item("2", 1), item("3", 3)], version: 4, avisos: ["lineas"] }),
    );
    m.reconciliar();
    await drenar(0);
    expect(llamadas).toEqual([
      {
        method: "POST",
        body: {
          items: [
            { id: "1", qty: 5 },
            { id: "3", qty: 3 },
          ],
        },
        keepalive: undefined,
      },
    ]);
    expect(m.leer().owner).toBe("u1");
    expect(lineas(m)).toEqual([
      ["1", 5],
      ["2", 1],
      ["3", 3],
    ]);
    expect(avisos.map((a) => a.titulo)).toEqual([
      "Algunos productos no se agregaron porque su carrito alcanzó el máximo de 60 productos.",
    ]);
  });

  it("si el merge falla, los ítems del invitado quedan y se reintenta al volver", async () => {
    cache(null, null, [item("1", 5)]);
    const m = crear();
    m.setSesion(true, "u1");
    respuestas.push(responder(503, {}));
    m.reconciliar();
    await drenar(0);
    expect(m.leer()).toEqual({ owner: null, version: null, items: [item("1", 5)] });

    respuestas.push(responder(200, { items: [item("1", 5)], version: 1, avisos: [] }));
    m.reconciliar(); // visibilitychange → visible
    await drenar(0);
    expect(llamadas.map((l) => l.method)).toEqual(["POST", "POST"]);
    expect(m.leer().owner).toBe("u1");
  });

  it("caché de otro usuario: se descarta sin mostrarla ni subirla", async () => {
    cache("u1", 5, [item("1", 2)]);
    const m = crear();
    m.setSesion(true, "u2");
    respuestas.push(responder(200, { items: [item("7", 1)], version: 3 }));
    m.reconciliar();
    await drenar(0);
    expect(llamadas.map((l) => l.method)).toEqual(["GET"]);
    expect(m.leer()).toEqual({ owner: "u2", version: 3, items: [item("7", 1)] });
    expect(JSON.stringify([...storage.values()])).not.toContain('"id":"1"');
  });

  it("sesión vencida (caché con dueño, sin usuario): vacía sin requests", async () => {
    cache("u1", 5, [item("1", 2)]);
    const m = crear();
    m.setSesion(true, null);
    m.reconciliar();
    await drenar(0);
    expect(llamadas).toEqual([]);
    expect(m.leer()).toEqual({ owner: null, version: null, items: [] });
  });

  it("mientras Clerk no cargó, no hace nada", async () => {
    cache("u1", 5, [item("1", 2)]);
    const m = crear();
    m.setSesion(false, null);
    m.reconciliar();
    await drenar(0);
    expect(llamadas).toEqual([]);
    expect(m.leer().owner).toBe("u1");
  });
});

describe("salida y pedido", () => {
  it("cerrar sesión: vacía la caché, no manda un carrito vacío y sube lo pendiente", async () => {
    cache("u1", 3, [item("1", 2)]);
    const m = crear();
    m.setSesion(true, "u1");
    m.mutar((items) => agregar(items, prod("2")));
    respuestas.push(responder(200, { items: [], version: 4, avisos: [] }));
    m.prepararCierreDeSesion();
    await drenar();
    expect(llamadas).toEqual([
      {
        method: "PUT",
        body: {
          version: 3,
          items: [
            { id: "1", qty: 2 },
            { id: "2", qty: 1 },
          ],
        },
        keepalive: true,
      },
    ]);
    expect(m.leer()).toEqual({ owner: null, version: null, items: [] });
  });

  it("cerrar sesión sin cambios pendientes no hace requests", async () => {
    cache("u1", 3, [item("1", 2)]);
    const m = crear();
    m.setSesion(true, "u1");
    m.prepararCierreDeSesion();
    m.mutar((items) => agregar(items, prod("5"))); // entre el cierre y el signOut
    await drenar();
    expect(llamadas).toEqual([]);
  });

  it("vaciar tras el pedido: sin PUT, descarta la respuesta en vuelo y trae la versión nueva", async () => {
    cache("u1", 3, [item("1", 2)]);
    const m = crear();
    m.setSesion(true, "u1");
    const enVuelo = diferida();
    respuestas.push(enVuelo.fn);
    m.mutar((items) => actualizarQty(items, "1", 3));
    await drenar();

    respuestas.push(responder(200, { items: [], version: 5 }));
    m.vaciarTrasPedido();
    await drenar(0);
    enVuelo.resolver(200, { items: [item("1", 3)], version: 4, avisos: [] });
    await drenar();

    expect(llamadas.map((l) => l.method)).toEqual(["PUT", "GET"]);
    expect(m.leer()).toEqual({ owner: "u1", version: 5, items: [] });
  });

  it("vaciar tras el pedido como invitado: sólo local", async () => {
    cache(null, null, [item("1", 2)]);
    const m = crear();
    m.setSesion(true, null);
    m.vaciarTrasPedido();
    await drenar();
    expect(llamadas).toEqual([]);
    expect(m.leer().items).toEqual([]);
  });
});
