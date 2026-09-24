import { describe, expect, it } from "vitest";
import {
  CARRITO_VACIO,
  CLAVE_CACHE_V1,
  COPY_CARRITO,
  MAX_ENTRADAS_BODY,
  MAX_LINEAS,
  QTY_MAX,
  accionAlCargar,
  actualizarQty,
  agregar,
  agregarVarios,
  aLineas,
  contenidoDistinto,
  itemsVisibles,
  mensajeAviso,
  mensajeError,
  mergeMax,
  normalizarCarrito,
  parsearCache,
  validarItemsBody,
  validarVersion,
  type CacheCarrito,
  type CartItem,
} from "./carrito-cliente";

const l = (id: string, qty: number) => ({ id, qty });
const ids = (n: number, desde = 1) => Array.from({ length: n }, (_, i) => String(desde + i));
const prod = (id: string, price = 100): Omit<CartItem, "qty"> => ({
  id,
  name: `Producto ${id}`,
  brand: "Marca",
  price,
});
const item = (id: string, qty: number): CartItem => ({ ...prod(id), qty });
const cache = (owner: string | null, items: CartItem[], version: number | null = null): CacheCarrito => ({
  owner,
  version,
  items,
});

describe("constantes", () => {
  it("topes del carrito", () => {
    expect(QTY_MAX).toBe(9_999);
    expect(MAX_LINEAS).toBe(60);
    expect(MAX_ENTRADAS_BODY).toBe(200);
  });
});

describe("normalizarCarrito", () => {
  it("agrupa duplicados, topa la cantidad y descarta qty <= 0", () => {
    const r = normalizarCarrito([l("1", 3), l("1", 2), l("2", 20_000), l("3", 0)]);
    expect(r.items).toEqual([l("1", 5), l("2", 9_999)]);
    expect(r.avisos).toEqual(["cantidad"]);
  });

  it("descarta ids vacíos y qty negativas sin aviso", () => {
    const r = normalizarCarrito([l("", 2), l("1", -3), l("2", 1)]);
    expect(r.items).toEqual([l("2", 1)]);
    expect(r.avisos).toEqual([]);
  });

  it("con 61 productos deja 60 y avisa el recorte", () => {
    const r = normalizarCarrito(ids(61).map((id) => l(id, 1)));
    expect(r.items).toHaveLength(60);
    expect(r.items.at(-1)?.id).toBe("60");
    expect(r.avisos).toEqual(["lineas"]);
  });

  it("conserva el resto de los campos de la primera aparición", () => {
    const r = normalizarCarrito([item("1", 1), { ...item("1", 2), name: "Otro" }]);
    expect(r.items).toEqual([{ ...item("1", 3) }]);
  });
});

describe("mergeMax", () => {
  it("unión con la cantidad mayor, no la suma", () => {
    const r = mergeMax([l("1", 2), l("2", 1)], [l("1", 5), l("3", 3)]);
    expect(r.items).toEqual([l("1", 5), l("2", 1), l("3", 3)]);
    expect(r.avisos).toEqual([]);
  });

  it("es idempotente (varias pestañas mergean el mismo invitado)", () => {
    const invitado = [l("1", 5), l("3", 3)];
    const una = mergeMax([l("1", 2)], invitado).items;
    const dos = mergeMax(una, invitado).items;
    const tres = mergeMax(dos, invitado).items;
    expect(una).toEqual([l("1", 5), l("3", 3)]);
    expect(dos).toEqual(una);
    expect(tres).toEqual(una);
  });

  it("servidor vacío", () => {
    expect(mergeMax([], [l("1", 1)]).items).toEqual([l("1", 1)]);
  });

  it("invitado con duplicados se agrupa antes de mergear", () => {
    expect(mergeMax([l("1", 4)], [l("1", 3), l("1", 3)]).items).toEqual([l("1", 6)]);
  });

  it("más de 60 líneas: quedan todas las del servidor y se avisa", () => {
    const servidor = ids(40).map((id) => l(id, 1));
    const invitado = ids(30, 100).map((id) => l(id, 1));
    const r = mergeMax(servidor, invitado);
    expect(r.items).toHaveLength(60);
    for (const s of servidor) expect(r.items).toContainEqual(s);
    expect(r.avisos).toEqual(["lineas"]);
    // Idempotente también con recorte.
    expect(mergeMax(r.items, invitado).items).toEqual(r.items);
  });
});

describe("validarItemsBody", () => {
  it("rechaza formas y tipos inválidos", () => {
    expect(validarItemsBody(null)).toBeNull();
    expect(validarItemsBody("x")).toBeNull();
    expect(validarItemsBody([])).toBeNull();
    expect(validarItemsBody({ items: "x" })).toBeNull();
    expect(validarItemsBody({ items: [{ id: "1", qty: 1.5 }] })).toBeNull();
    expect(validarItemsBody({ items: [{ id: "1", qty: "2" }] })).toBeNull();
    expect(validarItemsBody({ items: [{ id: 1, qty: 2 }] })).toBeNull();
    expect(validarItemsBody({ items: [{ id: "../contacts/1", qty: 2 }] })).toBeNull();
    expect(validarItemsBody({ items: [{ id: "1".repeat(65), qty: 2 }] })).toBeNull();
    expect(validarItemsBody({ items: [null] })).toBeNull();
    expect(
      validarItemsBody({ items: ids(MAX_ENTRADAS_BODY + 1).map((id) => l(id, 1)) }),
    ).toBeNull();
  });

  it("devuelve sólo id y qty de un body válido (normalizar es otro paso)", () => {
    expect(
      validarItemsBody({ items: [{ id: "1", qty: 2, name: "x" }, l("1", 0)], userId: "otro" }),
    ).toEqual([l("1", 2), l("1", 0)]);
    expect(validarItemsBody({ items: [] })).toEqual([]);
  });
});

describe("validarVersion", () => {
  it("entero >= 0", () => {
    expect(validarVersion(0)).toBe(0);
    expect(validarVersion(5)).toBe(5);
    expect(validarVersion(-1)).toBeNull();
    expect(validarVersion(1.5)).toBeNull();
    expect(validarVersion("3")).toBeNull();
    expect(validarVersion(undefined)).toBeNull();
  });
});

describe("agregar / agregarVarios / actualizarQty", () => {
  it("suma a una línea existente y topa con aviso", () => {
    const r = agregar([item("1", 9_998)], prod("1"), 5);
    expect(r.items).toEqual([item("1", 9_999)]);
    expect(r.avisos).toEqual(["cantidad"]);
  });

  it("no agrega una línea nueva si ya hay 60", () => {
    const lleno = ids(60).map((id) => item(id, 1));
    const r = agregar(lleno, prod("999"), 1);
    expect(r.items).toBe(lleno);
    expect(r.avisos).toEqual(["lineas"]);
    // Pero sí suma a una existente.
    expect(agregar(lleno, prod("1"), 1).items[0].qty).toBe(2);
  });

  it("agregarVarios suma 8 líneas en una sola pasada", () => {
    const lista = ids(8).map((id) => ({ item: prod(id), qty: 2 }));
    const r = agregarVarios([item("1", 1)], lista);
    expect(r.items).toHaveLength(8);
    expect(r.items[0].qty).toBe(3);
    expect(r.avisos).toEqual([]);
  });

  it("agregarVarios respeta topes y no repite avisos", () => {
    const lleno = ids(59).map((id) => item(id, 1));
    const r = agregarVarios(lleno, [
      { item: prod("500"), qty: 20_000 },
      { item: prod("501"), qty: 1 },
      { item: prod("502"), qty: 1 },
    ]);
    expect(r.items).toHaveLength(60);
    expect(r.items.at(-1)).toEqual(item("500", 9_999));
    expect(r.avisos).toEqual(["cantidad", "lineas"]);
  });

  it("actualizarQty topa, y con 0 quita", () => {
    expect(actualizarQty([item("1", 1)], "1", 20_000)).toEqual({
      items: [item("1", 9_999)],
      avisos: ["cantidad"],
    });
    expect(actualizarQty([item("1", 1), item("2", 1)], "1", 0).items).toEqual([item("2", 1)]);
  });

  it("aLineas deja sólo id y qty", () => {
    expect(aLineas([item("1", 2)])).toEqual([l("1", 2)]);
  });
});

describe("parsearCache", () => {
  it("lee la v2", () => {
    const raw = JSON.stringify(cache("user_1", [item("1", 2)], 4));
    expect(parsearCache(raw, null)).toEqual(cache("user_1", [item("1", 2)], 4));
  });

  it("migra la v1 como carrito de invitado", () => {
    const v1 = JSON.stringify([item("1", 2)]);
    expect(parsearCache(null, v1)).toEqual(cache(null, [item("1", 2)], null));
    expect(CLAVE_CACHE_V1).toBe("centralled.carrito.v1");
  });

  it("basura → vacío de invitado", () => {
    expect(parsearCache("{no json", null)).toEqual(cache(null, []));
    expect(parsearCache(JSON.stringify({ owner: 3, items: "x" }), null)).toEqual(cache(null, []));
    expect(parsearCache(null, null)).toEqual(cache(null, []));
  });

  it("valida ítem por ítem y la versión", () => {
    const raw = JSON.stringify({
      owner: "user_1",
      version: -2,
      items: [{ id: "1", qty: 20_000, price: 10 }, { id: "", qty: 1 }, { id: "2", qty: 0 }],
    });
    expect(parsearCache(raw, null)).toEqual(
      cache("user_1", [{ id: "1", name: "", brand: "", price: 10, qty: 9_999 }], null),
    );
  });
});

describe("itemsVisibles", () => {
  const items = [item("1", 2)];
  it("invitado: siempre visible", () => {
    expect(itemsVisibles(cache(null, items), { isLoaded: false, usuario: null })).toBe(items);
  });
  it("de un usuario: sólo con su sesión cargada", () => {
    expect(itemsVisibles(cache("u1", items), { isLoaded: true, usuario: "u1" })).toBe(items);
    expect(itemsVisibles(cache("u1", items), { isLoaded: true, usuario: "u2" })).toBe(CARRITO_VACIO);
    expect(itemsVisibles(cache("u1", items), { isLoaded: true, usuario: null })).toBe(CARRITO_VACIO);
    expect(itemsVisibles(cache("u1", items), { isLoaded: false, usuario: null })).toBe(CARRITO_VACIO);
  });
});

describe("accionAlCargar", () => {
  const items = [item("1", 2)];
  it("espera a que cargue la sesión", () => {
    expect(accionAlCargar(cache("u1", items), "u1", false)).toBe("esperar");
  });
  it("descarta el caché de otro usuario, o de un usuario sin sesión", () => {
    expect(accionAlCargar(cache("u1", items), "u2", true)).toBe("descartar");
    expect(accionAlCargar(cache("u1", items), null, true)).toBe("descartar");
    expect(accionAlCargar(cache("u1", []), null, true)).toBe("descartar");
  });
  it("mergea el invitado con ítems (también al reintentar tras una falla)", () => {
    expect(accionAlCargar(cache(null, items), "u1", true)).toBe("merge");
    expect(accionAlCargar(cache(null, items), "u1", true)).toBe("merge");
  });
  it("refresca si el caché es del usuario o es de invitado vacío", () => {
    expect(accionAlCargar(cache("u1", items, 3), "u1", true)).toBe("refrescar");
    expect(accionAlCargar(cache(null, []), "u1", true)).toBe("refrescar");
  });
  it("sin usuario y caché de invitado: nada", () => {
    expect(accionAlCargar(cache(null, items), null, true)).toBe("nada");
  });
});

describe("contenidoDistinto", () => {
  it("compara id y qty sin importar el orden ni los demás campos", () => {
    expect(contenidoDistinto([item("1", 2), item("2", 1)], [l("2", 1), l("1", 2)])).toBe(false);
    expect(contenidoDistinto([item("1", 2)], [item("1", 2)].map((i) => ({ ...i, price: 5 })))).toBe(false);
    expect(contenidoDistinto([item("1", 2)], [item("1", 3)])).toBe(true);
    expect(contenidoDistinto([item("1", 2)], [item("1", 2), item("2", 1)])).toBe(true);
    expect(contenidoDistinto([], [])).toBe(false);
  });
});

describe("mensajes", () => {
  it("errores por status, en usted", () => {
    expect(mensajeError(401)).toBe(COPY_CARRITO.noAutorizado);
    expect(mensajeError(400)).toBe(COPY_CARRITO.invalido);
    expect(mensajeError(409)).toBe(COPY_CARRITO.otroDispositivo);
    expect(mensajeError(429)).toBe(COPY_CARRITO.demasiadas);
    expect(mensajeError(500)).toBe(COPY_CARRITO.errorGuardar);
    expect(mensajeError(0)).toBe(COPY_CARRITO.errorGuardar);
    expect(COPY_CARRITO.demasiadas).toBe(
      "Demasiadas solicitudes. Inténtelo de nuevo en unos segundos.",
    );
    expect(COPY_CARRITO.noAutorizado).toBe("Inicie sesión para guardar su carrito.");
  });

  it("avisos", () => {
    expect(mensajeAviso("lineas")).toBe(
      "Algunos productos no se agregaron porque su carrito alcanzó el máximo de 60 productos.",
    );
    expect(mensajeAviso("cantidad")).toBe("Se ajustó la cantidad al máximo permitido.");
  });

  it("ningún texto tutea", () => {
    for (const t of Object.values(COPY_CARRITO)) {
      expect(t).not.toMatch(/\b(tu|tus|te|vos)\b/i);
    }
  });
});
