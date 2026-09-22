import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * API de direcciones de envío (colección y por id): sólo Clerk, errores en
 * usted, 404 uniforme para lo ajeno o inexistente y nunca cacheable. Toda
 * mutación devuelve la lista entera, en el orden de la vista.
 */

let userId: string | null = "user_1";
let permitido = true;
const permitir = vi.fn<(...a: unknown[]) => boolean>(() => permitido);

const ID = "0b8f7d1e-7c55-4a38-9d0e-2c1f7f6b9a10";
const guardada = { id: ID, etiqueta: "Casa", calle: "Av. Victoria Aguirre 100", ciudad: "Puerto Iguazú", provincia: "Misiones", cp: "3370", referencias: null, predeterminada: true };

const listarDirecciones = vi.fn<(...a: unknown[]) => Promise<unknown[]>>(async () => [guardada]);
const crearDireccion = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => guardada);
const actualizarDireccion = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => guardada);
const eliminarDireccion = vi.fn<(...a: unknown[]) => Promise<boolean>>(async () => true);
const marcarPredeterminada = vi.fn<(...a: unknown[]) => Promise<boolean>>(async () => true);

const { DireccionesLlenasError } = vi.hoisted(() => ({
  DireccionesLlenasError: class DireccionesLlenasError extends Error {},
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId }) }));
vi.mock("@/lib/rate-limit", () => ({ permitir: (...a: unknown[]) => permitir(...a) }));
vi.mock("@/lib/direcciones-envio-db", () => ({
  DireccionesLlenasError,
  listarDirecciones: (...a: unknown[]) => listarDirecciones(...a),
  crearDireccion: (...a: unknown[]) => crearDireccion(...a),
  actualizarDireccion: (...a: unknown[]) => actualizarDireccion(...a),
  eliminarDireccion: (...a: unknown[]) => eliminarDireccion(...a),
  marcarPredeterminada: (...a: unknown[]) => marcarPredeterminada(...a),
}));

import { GET, POST } from "./route";
import { DELETE, PUT } from "./[id]/route";
import { POST as PREDETERMINADA } from "./[id]/predeterminada/route";

const BASE = "http://localhost/api/mi-cuenta/direcciones";
const valida = { etiqueta: "Casa", calle: "Av. Victoria Aguirre 100", ciudad: "Puerto Iguazú", provincia: "Misiones", cp: "3370" };

const req = (method: string, body?: unknown, url = BASE) =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });

async function esperaError(res: Response, status: number, error: string) {
  expect(res.status).toBe(status);
  expect((await res.json()).error).toBe(error);
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
}

const mutaciones = () => [crearDireccion, actualizarDireccion, eliminarDireccion, marcarPredeterminada];

beforeEach(() => {
  userId = "user_1";
  permitido = true;
  for (const f of [permitir, listarDirecciones, ...mutaciones()]) f.mockClear();
});

describe("sin sesión de Clerk", () => {
  it("todos los métodos → 401 sin tocar la base ni consumir usos", async () => {
    userId = null;
    await esperaError(await GET(), 401, "No autorizado");
    await esperaError(await POST(req("POST", valida)), 401, "No autorizado");
    await esperaError(await PUT(req("PUT", valida), ctx()), 401, "No autorizado");
    await esperaError(await DELETE(req("DELETE"), ctx()), 401, "No autorizado");
    await esperaError(await PREDETERMINADA(req("POST"), ctx()), 401, "No autorizado");
    expect(listarDirecciones).not.toHaveBeenCalled();
    for (const f of mutaciones()) expect(f).not.toHaveBeenCalled();
    expect(permitir).not.toHaveBeenCalled();
  });
});

describe("GET", () => {
  it("200 con las direcciones del usuario", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ direcciones: [guardada] });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(listarDirecciones).toHaveBeenCalledWith("user_1");
  });
});

describe("POST (crear)", () => {
  it("201 con la creada y la lista, guardando datos normalizados", async () => {
    const res = await POST(req("POST", { ...valida, provincia: "misiones", predeterminada: true }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ direccion: guardada, direcciones: [guardada] });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(crearDireccion).toHaveBeenCalledWith("user_1", {
      etiqueta: "Casa",
      calle: "Av. Victoria Aguirre 100",
      ciudad: "Puerto Iguazú",
      provincia: "Misiones",
      cp: "3370",
      referencias: null,
      predeterminada: true,
    });
  });

  it("acepta una localidad fuera de la zona de envío", async () => {
    const res = await POST(req("POST", { ...valida, ciudad: "Rosario", provincia: "Santa Fe", cp: "2000" }));
    expect(res.status).toBe(201);
  });

  it.each([
    ["no es JSON", "{nope"],
    ["un array", [valida]],
    ["null", "null"],
  ])("400 si el cuerpo %s", async (_caso, body) => {
    await esperaError(await POST(req("POST", body)), 400, "Solicitud inválida.");
    expect(crearDireccion).not.toHaveBeenCalled();
  });

  it("422 con los errores por campo, en usted", async () => {
    const res = await POST(req("POST", { ...valida, provincia: "", cp: "x" }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.errores).toEqual({
      provincia: "Seleccione la provincia.",
      cp: "Indique un código postal válido (por ejemplo, 3370).",
    });
    expect(json.error).toBe("Revise los datos de la dirección.");
    expect(crearDireccion).not.toHaveBeenCalled();
  });

  it("422 al superar el tope de 10", async () => {
    crearDireccion.mockRejectedValueOnce(new DireccionesLlenasError());
    await esperaError(await POST(req("POST", valida)), 422, "Alcanzó el máximo de 10 direcciones guardadas.");
  });

  it("otro error se propaga (500 de Next)", async () => {
    crearDireccion.mockRejectedValueOnce(new Error("base caída"));
    await expect(POST(req("POST", valida))).rejects.toThrow("base caída");
  });
});

describe("PUT /[id] (editar)", () => {
  it("200 con la editada y la lista", async () => {
    const res = await PUT(req("PUT", valida), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ direccion: guardada, direcciones: [guardada] });
    expect(actualizarDireccion).toHaveBeenCalledWith("user_1", ID, expect.objectContaining({ calle: "Av. Victoria Aguirre 100" }));
  });

  it("404 uniforme si es ajena o no existe", async () => {
    actualizarDireccion.mockResolvedValueOnce(null);
    await esperaError(await PUT(req("PUT", valida), ctx()), 404, "No encontramos esa dirección.");
  });

  it("404 uniforme sin consultar si el id no es un uuid", async () => {
    await esperaError(await PUT(req("PUT", valida), ctx("abc")), 404, "No encontramos esa dirección.");
    expect(actualizarDireccion).not.toHaveBeenCalled();
  });

  it("400 y 422 como en el alta", async () => {
    await esperaError(await PUT(req("PUT", "{nope"), ctx()), 400, "Solicitud inválida.");
    expect((await PUT(req("PUT", {}), ctx())).status).toBe(422);
    expect(actualizarDireccion).not.toHaveBeenCalled();
  });
});

describe("DELETE /[id]", () => {
  it("200 con la lista que queda", async () => {
    const res = await DELETE(req("DELETE"), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ direcciones: [guardada] });
    expect(eliminarDireccion).toHaveBeenCalledWith("user_1", ID);
  });

  it("404 uniforme (ajena, inexistente o id inválido)", async () => {
    eliminarDireccion.mockResolvedValueOnce(false);
    await esperaError(await DELETE(req("DELETE"), ctx()), 404, "No encontramos esa dirección.");
    await esperaError(await DELETE(req("DELETE"), ctx("x")), 404, "No encontramos esa dirección.");
    expect(eliminarDireccion).toHaveBeenCalledTimes(1);
  });
});

describe("POST /[id]/predeterminada", () => {
  it("200 con la lista reordenada", async () => {
    const res = await PREDETERMINADA(req("POST"), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ direcciones: [guardada] });
    expect(marcarPredeterminada).toHaveBeenCalledWith("user_1", ID);
  });

  it("404 uniforme", async () => {
    marcarPredeterminada.mockResolvedValueOnce(false);
    await esperaError(await PREDETERMINADA(req("POST"), ctx()), 404, "No encontramos esa dirección.");
  });
});

describe("rate limit", () => {
  it("60 por minuto por usuario, con namespace propio y compartido entre rutas", async () => {
    await GET();
    await PREDETERMINADA(req("POST"), ctx());
    expect(permitir).toHaveBeenNthCalledWith(1, "direcciones:clerk:user_1", 60, 60_000);
    expect(permitir).toHaveBeenNthCalledWith(2, "direcciones:clerk:user_1", 60, 60_000);
  });

  it("429 excedido en todos los métodos, sin tocar la base", async () => {
    permitido = false;
    const msg = "Demasiadas solicitudes. Inténtelo de nuevo en unos minutos.";
    await esperaError(await GET(), 429, msg);
    await esperaError(await POST(req("POST", valida)), 429, msg);
    await esperaError(await PUT(req("PUT", valida), ctx()), 429, msg);
    await esperaError(await DELETE(req("DELETE"), ctx()), 429, msg);
    await esperaError(await PREDETERMINADA(req("POST"), ctx()), 429, msg);
    expect(listarDirecciones).not.toHaveBeenCalled();
    for (const f of mutaciones()) expect(f).not.toHaveBeenCalled();
  });
});
