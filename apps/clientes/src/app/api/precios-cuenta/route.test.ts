import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/api/precios-cuenta`: el overlay con los precios de la lista PRIVADA del comprador. La lista sale
 * SIEMPRE de la sesión (`listaPrivadaDelComprador`), nunca de la URL. Anónimo, logueado sin cuenta
 * vinculada y cuenta sin lista enlazada reciben `conLista: false` y NINGÚN precio privado.
 */
const listaPrivadaDelComprador = vi.fn();
const preciosCuentaPorIds = vi.fn();
const permitir = vi.fn();
let cliente: { codigocliente: string } | null = { codigocliente: "42" };

vi.mock("@/lib/auth", () => ({ identidadActual: async () => ({ clerkUserId: "user_1", cliente }) }));
vi.mock("@/lib/lista-cuenta-repo", () => ({ listaPrivadaDelComprador: () => listaPrivadaDelComprador() }));
vi.mock("@/lib/precios-privados-repo", () => ({ preciosCuentaPorIds: (...a: unknown[]) => preciosCuentaPorIds(...a) }));
vi.mock("@/lib/rate-limit", () => ({ permitir: (...a: unknown[]) => permitir(...a) }));

import { GET } from "./route";

const pedir = (query = "ids=1,2") => GET(new Request(`https://tienda.example/api/precios-cuenta?${query}`));

beforeEach(() => {
  cliente = { codigocliente: "42" };
  listaPrivadaDelComprador.mockReset();
  preciosCuentaPorIds.mockReset();
  permitir.mockReset().mockReturnValue(true);
  listaPrivadaDelComprador.mockResolvedValue("lista-privada-a");
  preciosCuentaPorIds.mockResolvedValue({ "1": { price: 800, precioFinal: 968 }, "2": null });
});

describe("GET /api/precios-cuenta", () => {
  it("con lista privada devuelve el precio de cada id y null (Consulte) para el que no tiene", async () => {
    const r = await pedir();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ conLista: true, precios: { "1": { price: 800, precioFinal: 968 }, "2": null } });
    expect(preciosCuentaPorIds).toHaveBeenCalledWith("lista-privada-a", ["1", "2"]);
  });

  it("la respuesta es privada y sin caché", async () => {
    const r = await pedir();
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("sin lista privada (contado, sin enlace, sin vincular): conLista:false y no lee ningún precio privado", async () => {
    listaPrivadaDelComprador.mockResolvedValue(null);
    const r = await pedir();
    expect(await r.json()).toEqual({ conLista: false, precios: {} });
    expect(preciosCuentaPorIds).not.toHaveBeenCalled();
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("anónimo: conLista:false, sin precios privados y sin gastar el rate limit", async () => {
    cliente = null;
    listaPrivadaDelComprador.mockResolvedValue(null);
    const r = await pedir();
    expect(await r.json()).toEqual({ conLista: false, precios: {} });
    expect(preciosCuentaPorIds).not.toHaveBeenCalled();
    expect(permitir).not.toHaveBeenCalled();
  });

  it("la lista nunca viene del cliente: un listaId en la URL se ignora", async () => {
    await pedir("ids=1&lista=otra-lista&listaId=otra-lista");
    expect(preciosCuentaPorIds).toHaveBeenCalledWith("lista-privada-a", ["1"]);
  });

  it("descarta ids que no son numéricos, repetidos y topea en 60", async () => {
    const muchos = Array.from({ length: 100 }, (_, i) => String(i + 1)).join(",");
    await pedir(`ids=${muchos},../x,1,abc`);
    const ids = preciosCuentaPorIds.mock.calls[0][1] as string[];
    expect(ids).toHaveLength(60);
    expect(new Set(ids).size).toBe(60);
    expect(ids.every((id) => /^\d+$/.test(id))).toBe(true);
  });

  it("excedido el rate limit responde 429 sin leer precios", async () => {
    permitir.mockReturnValue(false);
    const r = await pedir();
    expect(r.status).toBe(429);
    expect(preciosCuentaPorIds).not.toHaveBeenCalled();
  });

  it("si la base falla responde 503 en usted (el navegador se queda con el público)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    preciosCuentaPorIds.mockRejectedValue(new Error("base caída"));
    const r = await pedir();
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe("No se pudieron obtener sus precios.");
  });

  it("si no se puede resolver la lista responde 503, nunca un precio público como privado", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    listaPrivadaDelComprador.mockRejectedValue(new Error("base caída"));
    const r = await pedir();
    expect(r.status).toBe(503);
    expect(preciosCuentaPorIds).not.toHaveBeenCalled();
  });
});
