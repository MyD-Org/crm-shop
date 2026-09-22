import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * API de favoritos: sólo Clerk (la cookie del CRM no alcanza), body
 * `{ alegraItemId }`, errores en usted y nunca cacheable.
 */

let userId: string | null = "user_1";
let permitido = true;
const permitir = vi.fn((..._a: unknown[]) => permitido);
const agregarFavorito = vi.fn(async (..._a: unknown[]) => {});
const quitarFavorito = vi.fn(async (..._a: unknown[]) => {});
const idsFavoritos = vi.fn(async (..._a: unknown[]) => ["42"]);

// `vi.mock` se iza sobre las declaraciones: la clase tiene que izarse también.
const { FavoritosLlenosError } = vi.hoisted(() => ({
  FavoritosLlenosError: class FavoritosLlenosError extends Error {},
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId }) }));
vi.mock("@/lib/rate-limit", () => ({ permitir: (...a: unknown[]) => permitir(...a) }));
vi.mock("@/lib/favoritos", () => ({
  FavoritosLlenosError,
  MAX_FAVORITOS: 200,
  agregarFavorito: (...a: unknown[]) => agregarFavorito(...a),
  quitarFavorito: (...a: unknown[]) => quitarFavorito(...a),
  idsFavoritos: (...a: unknown[]) => idsFavoritos(...a),
}));

import { DELETE, GET, PUT } from "./route";

const URL_API = "http://localhost/api/mi-cuenta/favoritos";
const conBody = (method: "PUT" | "DELETE", body: unknown) =>
  new Request(URL_API, {
    method,
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

async function esperaError(res: Response, status: number, error: string) {
  expect(res.status).toBe(status);
  expect(await res.json()).toEqual({ error });
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
}

beforeEach(() => {
  userId = "user_1";
  permitido = true;
  permitir.mockClear();
  agregarFavorito.mockClear();
  quitarFavorito.mockClear();
  idsFavoritos.mockClear();
});

describe("sin sesión de Clerk", () => {
  beforeEach(() => {
    userId = null;
  });

  it("GET, PUT y DELETE → 401 sin tocar la base", async () => {
    await esperaError(await GET(), 401, "No autorizado");
    await esperaError(await PUT(conBody("PUT", { alegraItemId: "42" })), 401, "No autorizado");
    await esperaError(await DELETE(conBody("DELETE", { alegraItemId: "42" })), 401, "No autorizado");
    expect(agregarFavorito).not.toHaveBeenCalled();
    expect(quitarFavorito).not.toHaveBeenCalled();
    expect(idsFavoritos).not.toHaveBeenCalled();
  });
});

describe("GET", () => {
  it("200 con los ids del usuario", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ids: ["42"] });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(idsFavoritos).toHaveBeenCalledWith("user_1");
  });
});

describe("PUT", () => {
  it("200 { ok: true } y guarda para el usuario de la sesión", async () => {
    const res = await PUT(conBody("PUT", { alegraItemId: "42" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(agregarFavorito).toHaveBeenCalledWith("user_1", "42");
  });

  it.each([
    ["body vacío", {}],
    ["string vacío", { alegraItemId: "" }],
    ["sólo espacios", { alegraItemId: "   " }],
    ["número", { alegraItemId: 42 }],
    ["más de 64 caracteres", { alegraItemId: "1".repeat(65) }],
    ["no es JSON", "{nope"],
  ])("400 con %s", async (_caso, body) => {
    await esperaError(await PUT(conBody("PUT", body)), 400, "Indique el producto.");
    expect(agregarFavorito).not.toHaveBeenCalled();
  });

  it("64 caracteres todavía es válido", async () => {
    const res = await PUT(conBody("PUT", { alegraItemId: "1".repeat(64) }));
    expect(res.status).toBe(200);
  });

  it("422 al superar el tope", async () => {
    agregarFavorito.mockRejectedValueOnce(new FavoritosLlenosError());
    await esperaError(
      await PUT(conBody("PUT", { alegraItemId: "42" })),
      422,
      "Alcanzó el máximo de 200 favoritos.",
    );
  });

  it("otro error se propaga (500 de Next, sin mensaje inventado)", async () => {
    agregarFavorito.mockRejectedValueOnce(new Error("base caída"));
    await expect(PUT(conBody("PUT", { alegraItemId: "42" }))).rejects.toThrow("base caída");
  });
});

describe("DELETE", () => {
  it("200 { ok: true } y quita para el usuario de la sesión", async () => {
    const res = await DELETE(conBody("DELETE", { alegraItemId: "42" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(quitarFavorito).toHaveBeenCalledWith("user_1", "42");
  });

  it("400 sin producto", async () => {
    await esperaError(await DELETE(conBody("DELETE", {})), 400, "Indique el producto.");
    expect(quitarFavorito).not.toHaveBeenCalled();
  });
});

describe("rate limit", () => {
  it("60 por minuto por usuario, con namespace propio", async () => {
    await PUT(conBody("PUT", { alegraItemId: "42" }));
    expect(permitir).toHaveBeenCalledWith("favoritos:clerk:user_1", 60, 60_000);
  });

  it("429 excedido, en todos los métodos y sin tocar la base", async () => {
    permitido = false;
    const msg = "Demasiadas solicitudes. Inténtelo de nuevo en unos minutos.";
    await esperaError(await GET(), 429, msg);
    await esperaError(await PUT(conBody("PUT", { alegraItemId: "42" })), 429, msg);
    await esperaError(await DELETE(conBody("DELETE", { alegraItemId: "42" })), 429, msg);
    expect(agregarFavorito).not.toHaveBeenCalled();
    expect(quitarFavorito).not.toHaveBeenCalled();
    expect(idsFavoritos).not.toHaveBeenCalled();
  });

  it("sin sesión no consume usos", async () => {
    userId = null;
    await GET();
    expect(permitir).not.toHaveBeenCalled();
  });
});
