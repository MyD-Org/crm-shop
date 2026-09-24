import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * API del carrito por usuario: sólo Clerk (la cookie del CRM no alcanza), el
 * usuario sale de `auth()` y nunca del body, errores en usted y nunca
 * cacheable. La base y el catálogo están mockeados (ver carrito-db.test.ts
 * para la forma del SQL).
 */

type Linea = { id: string; qty: number };

let userId: string | null = "user_1";
let permitido = true;
let cliente: { codigocliente: string } | null = null;

const permitir = vi.fn<(...a: unknown[]) => boolean>(() => permitido);
const leerCarrito = vi.fn<(u: string) => Promise<{ items: Linea[]; version: number }>>(
  async () => ({ items: [], version: 0 }),
);
const reemplazarCarrito = vi.fn(
  async (
    _u: string,
    _v: number,
    items: Linea[],
  ): Promise<
    | { ok: true; carrito: { items: Linea[]; version: number }; avisos: string[] }
    | { ok: false; actual: { items: Linea[]; version: number } }
  > => ({ ok: true, carrito: { items, version: 1 }, avisos: [] }),
);
const mergearCarrito = vi.fn(async (_u: string, items: Linea[]) => ({
  items,
  version: 3,
  avisos: [] as string[],
}));
const enriquecer = vi.fn<(lineas: Linea[], lista: string | undefined) => Promise<unknown[]>>(
  async (lineas) =>
    lineas.map((l) =>
      l.id === "999"
        ? { ...l, name: "", brand: "", price: 0, faltante: true }
        : { ...l, name: `Producto ${l.id}`, brand: "Marca", price: 100 },
    ),
);
const idPriceListCliente = vi.fn<(c: string) => Promise<string>>(async () => "7");

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId }) }));
vi.mock("@/lib/rate-limit", () => ({ permitir: (...a: unknown[]) => permitir(...a) }));
vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: userId, cliente }),
  idPriceListCliente: (c: string) => idPriceListCliente(c),
}));
vi.mock("@/lib/carrito-db", () => ({
  leerCarrito: (u: string) => leerCarrito(u),
  reemplazarCarrito: (u: string, v: number, i: Linea[]) => reemplazarCarrito(u, v, i),
  mergearCarrito: (u: string, i: Linea[]) => mergearCarrito(u, i),
  enriquecer: (l: Linea[], p: string | undefined) => enriquecer(l, p),
}));

import { GET, POST, PUT } from "./route";

const URL_API = "http://localhost/api/carrito";
const conBody = (method: "PUT" | "POST", body: unknown) =>
  new Request(URL_API, {
    method,
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const NO_AUTORIZADO = "Inicie sesión para guardar su carrito.";
const INVALIDO = "El carrito enviado no es válido.";
const DEMASIADAS = "Demasiadas solicitudes. Inténtelo de nuevo en unos segundos.";

async function esperaError(res: Response, status: number, error: string) {
  expect(res.status).toBe(status);
  expect(await res.json()).toEqual({ error });
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
}

function nadaEscrito() {
  expect(reemplazarCarrito).not.toHaveBeenCalled();
  expect(mergearCarrito).not.toHaveBeenCalled();
}

beforeEach(() => {
  userId = "user_1";
  permitido = true;
  cliente = null;
  vi.clearAllMocks();
});

describe("sin sesión de Clerk", () => {
  it("GET, PUT y POST → 401 sin tocar la base", async () => {
    userId = null;
    await esperaError(await GET(), 401, NO_AUTORIZADO);
    await esperaError(
      await PUT(conBody("PUT", { version: 0, items: [{ id: "1", qty: 1 }] })),
      401,
      NO_AUTORIZADO,
    );
    await esperaError(await POST(conBody("POST", { items: [{ id: "1", qty: 1 }] })), 401, NO_AUTORIZADO);
    nadaEscrito();
    expect(leerCarrito).not.toHaveBeenCalled();
    expect(permitir).not.toHaveBeenCalled();
  });

  it("con cookie del CRM pero sin Clerk también es 401", async () => {
    userId = null;
    cliente = { codigocliente: "123" };
    await esperaError(
      await PUT(conBody("PUT", { version: 0, items: [{ id: "1", qty: 1 }] })),
      401,
      NO_AUTORIZADO,
    );
    nadaEscrito();
  });
});

describe("rate limit", () => {
  it("120 por minuto por usuario, compartido por los tres métodos", async () => {
    await GET();
    await PUT(conBody("PUT", { version: 0, items: [] }));
    await POST(conBody("POST", { items: [] }));
    expect(permitir).toHaveBeenCalledTimes(3);
    for (const c of permitir.mock.calls) expect(c).toEqual(["carrito:clerk:user_1", 120, 60_000]);
  });

  it("429 en usted, en todos los métodos y sin tocar la base", async () => {
    permitido = false;
    await esperaError(await GET(), 429, DEMASIADAS);
    await esperaError(await PUT(conBody("PUT", { version: 0, items: [] })), 429, DEMASIADAS);
    await esperaError(await POST(conBody("POST", { items: [] })), 429, DEMASIADAS);
    nadaEscrito();
    expect(leerCarrito).not.toHaveBeenCalled();
  });
});

describe("GET", () => {
  it("sin fila → { items: [], version: 0 }", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], version: 0 });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(leerCarrito).toHaveBeenCalledWith("user_1");
  });

  it("enriquece con la lista de precios del cliente y marca los faltantes", async () => {
    cliente = { codigocliente: "55" };
    leerCarrito.mockResolvedValueOnce({
      items: [
        { id: "1", qty: 2 },
        { id: "999", qty: 1 },
      ],
      version: 4,
    });
    const res = await GET();
    expect(await res.json()).toEqual({
      items: [
        { id: "1", qty: 2, name: "Producto 1", brand: "Marca", price: 100 },
        { id: "999", qty: 1, name: "", brand: "", price: 0, faltante: true },
      ],
      version: 4,
    });
    expect(idPriceListCliente).toHaveBeenCalledWith("55");
    expect(enriquecer).toHaveBeenCalledWith(expect.any(Array), "7");
  });

  it("sin cliente comercial, precio de lista general (idPriceList undefined)", async () => {
    leerCarrito.mockResolvedValueOnce({ items: [{ id: "1", qty: 1 }], version: 1 });
    await GET();
    expect(idPriceListCliente).not.toHaveBeenCalled();
    expect(enriquecer).toHaveBeenCalledWith([{ id: "1", qty: 1 }], undefined);
  });
});

describe("PUT", () => {
  it("200 → { items, version, avisos } del usuario de la sesión", async () => {
    reemplazarCarrito.mockResolvedValueOnce({
      ok: true,
      carrito: { items: [{ id: "1", qty: 9999 }], version: 5 },
      avisos: ["cantidad"],
    });
    const res = await PUT(conBody("PUT", { version: 4, items: [{ id: "1", qty: 20000 }] }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({
      items: [{ id: "1", qty: 9999, name: "Producto 1", brand: "Marca", price: 100 }],
      version: 5,
      avisos: ["cantidad"],
    });
    expect(reemplazarCarrito).toHaveBeenCalledWith("user_1", 4, [{ id: "1", qty: 20000 }]);
  });

  it("acepta el carrito vacío", async () => {
    const res = await PUT(conBody("PUT", { version: 2, items: [] }));
    expect(res.status).toBe(200);
    expect(reemplazarCarrito).toHaveBeenCalledWith("user_1", 2, []);
  });

  it("409 → { error, items, version } actuales", async () => {
    reemplazarCarrito.mockResolvedValueOnce({
      ok: false,
      actual: { items: [{ id: "2", qty: 1 }], version: 5 },
    });
    const res = await PUT(conBody("PUT", { version: 3, items: [{ id: "1", qty: 1 }] }));
    expect(res.status).toBe(409);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({
      error: "Su carrito se actualizó desde otro dispositivo.",
      items: [{ id: "2", qty: 1, name: "Producto 2", brand: "Marca", price: 100 }],
      version: 5,
    });
  });

  it("un userId en el body se ignora: escribe el carrito de la sesión", async () => {
    await PUT(conBody("PUT", { userId: "user_2", owner: "user_2", version: 0, items: [] }));
    expect(reemplazarCarrito).toHaveBeenCalledWith("user_1", 0, []);
  });

  it.each([
    ["items no es array", { version: 0, items: "x" }],
    ["JSON inválido", "{nope"],
    ["sin version", { items: [] }],
    ["version negativa", { version: -1, items: [] }],
    ["version no entera", { version: 1.5, items: [] }],
    ["version string", { version: "1", items: [] }],
    ["qty no entera", { version: 0, items: [{ id: "1", qty: 1.5 }] }],
    ["id no numérico", { version: 0, items: [{ id: "abc", qty: 1 }] }],
    ["más de 200 entradas", { version: 0, items: Array.from({ length: 201 }, () => ({ id: "1", qty: 1 })) }],
  ])("400 con %s, sin escribir", async (_caso, body) => {
    await esperaError(await PUT(conBody("PUT", body)), 400, INVALIDO);
    nadaEscrito();
  });

  it("400 con un body de más de 16 KB", async () => {
    const grande = JSON.stringify({ version: 0, items: [], relleno: "x".repeat(17 * 1024) });
    await esperaError(await PUT(conBody("PUT", grande)), 400, INVALIDO);
    nadaEscrito();
  });
});

describe("POST (merge)", () => {
  it("200 → { items, version, avisos }", async () => {
    mergearCarrito.mockResolvedValueOnce({
      items: [
        { id: "1", qty: 5 },
        { id: "2", qty: 3 },
      ],
      version: 7,
      avisos: ["lineas"],
    });
    const res = await POST(conBody("POST", { items: [{ id: "1", qty: 5 }, { id: "2", qty: 3 }] }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.version).toBe(7);
    expect(body.avisos).toEqual(["lineas"]);
    expect(body.items.map((i: Linea) => [i.id, i.qty])).toEqual([
      ["1", 5],
      ["2", 3],
    ]);
    expect(mergearCarrito).toHaveBeenCalledWith("user_1", [
      { id: "1", qty: 5 },
      { id: "2", qty: 3 },
    ]);
  });

  it("un userId en el body se ignora", async () => {
    await POST(conBody("POST", { userId: "user_2", items: [{ id: "1", qty: 1 }] }));
    expect(mergearCarrito).toHaveBeenCalledWith("user_1", [{ id: "1", qty: 1 }]);
  });

  it.each([
    ["items no es array", { items: "x" }],
    ["JSON inválido", "{nope"],
  ])("400 con %s, sin escribir", async (_caso, body) => {
    await esperaError(await POST(conBody("POST", body)), 400, INVALIDO);
    nadaEscrito();
  });
});
