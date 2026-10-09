import { beforeEach, describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";

const identidad = vi.fn();
const listaPrivadaDelComprador = vi.fn();
const preciosPrivados = vi.fn();
const getProductosPorIds = vi.fn();
const permitir = vi.fn();
vi.mock("@/lib/auth", () => ({ identidadActual: () => identidad() }));
vi.mock("@/lib/lista-cuenta-repo", () => ({ listaPrivadaDelComprador: () => listaPrivadaDelComprador() }));
vi.mock("@/lib/precios-privados-repo", () => ({ preciosPrivados: (...a: unknown[]) => preciosPrivados(...a) }));
vi.mock("@/lib/catalog", () => ({ getProductosPorIds: (...a: unknown[]) => getProductosPorIds(...a) }));
vi.mock("@/lib/rate-limit", () => ({ permitirAsync: async (...a: unknown[]) => permitir(...a) }));
const disponibles = vi.fn(async () => false);
vi.mock("@/lib/catalogo-atributos-disponibles", () => ({ atributosEstructuradosDisponibles: () => disponibles() }));
vi.mock("@/lib/flags-publicos", () => ({ flagsPublicos: async () => ({ soloVisibles: false, cuotas: false }) }));

import { GET } from "./route";

const pedir = (qs: string) => GET(new Request(`http://localhost/api/chat-ia/productos${qs}`));
const prod = (id: string, precioFinal = 121): Record<string, unknown> => ({ id, name: `P${id}`, brand: "", price: 100, precioFinal, stock: "in" });

beforeEach(() => {
  vi.stubEnv("AI_API_URL", "https://ai.plataforma.example");
  vi.stubEnv("AI_API_KEY", "clave");
  vi.stubEnv("AI_AGENT_ID", "agente-1");
  identidad.mockReset();
  listaPrivadaDelComprador.mockReset().mockResolvedValue(null);
  preciosPrivados.mockReset();
  getProductosPorIds.mockReset();
  permitir.mockReset();
  permitir.mockReturnValue(true);
  identidad.mockResolvedValue({ clerkUserId: null, cliente: null });
  setFlag("chat-ia", true);
});

describe("GET /api/chat-ia/productos", () => {
  it("flag apagado ⇒ 404", async () => {
    setFlag("chat-ia", false);
    expect((await pedir("?ids=1")).status).toBe(404);
  });

  it("descarta ids inválidos y no consulta si no queda ninguno", async () => {
    const res = await pedir("?ids=abc,../x");
    expect(await res.json()).toEqual([]);
    expect(getProductosPorIds).not.toHaveBeenCalled();
  });

  it("visitante ⇒ precio público; respeta el orden pedido y omite los que faltan", async () => {
    getProductosPorIds.mockResolvedValue(new Map([["2", prod("2")], ["1", prod("1")]]));
    const res = await pedir("?ids=1,3,2,1");
    expect(getProductosPorIds).toHaveBeenCalledWith(["1", "3", "2"], {
      soloActivos: true,
      soloVisibles: false,
    });
    expect((await res.json()).map((p: { id: string }) => p.id)).toEqual(["1", "2"]);
    expect(listaPrivadaDelComprador).not.toHaveBeenCalled();
    expect(preciosPrivados).not.toHaveBeenCalled();
  });

  it("atributos estructurados sólo con busqueda-ia Y la tabla disponible", async () => {
    getProductosPorIds.mockResolvedValue(new Map([["1", prod("1")]]));
    disponibles.mockResolvedValue(true);
    await pedir("?ids=1");
    expect(getProductosPorIds).toHaveBeenLastCalledWith(["1"], { soloActivos: true, soloVisibles: false });
    setFlag("busqueda-ia", true);
    await pedir("?ids=1");
    expect(getProductosPorIds).toHaveBeenLastCalledWith(["1"], {
      soloActivos: true,
      soloVisibles: false,
      atributosEstructurados: true,
    });
    disponibles.mockResolvedValue(false);
  });

  it("cliente con lista privada ⇒ su precio, sacado de la sesión; sin precio en su lista no se resuelve", async () => {
    identidad.mockResolvedValue({ clerkUserId: "u", cliente: { codigocliente: "42" } });
    listaPrivadaDelComprador.mockResolvedValue("lista-privada-a");
    preciosPrivados.mockResolvedValue(new Map([["1", 500], ["2", null]]));
    getProductosPorIds.mockResolvedValue(
      new Map([["1", { ...prod("1"), ivaPorcentaje: 21, precioMedio: { slug: "t" } }], ["2", prod("2")]]),
    );
    const res = await pedir("?ids=1,2&idPriceList=otra&lista=otra");
    expect(preciosPrivados).toHaveBeenCalledWith("lista-privada-a", ["1", "2"]);
    const salida = (await res.json()) as { id: string; price?: number; precioFinal?: number }[];
    expect(salida.map((p) => p.id)).toEqual(["1"]);
    expect(JSON.stringify(salida)).not.toContain('"price":100');
    expect(permitir).toHaveBeenCalledWith("chat-ia-productos:42", 60, 60_000);
  });

  it("base caída ⇒ 502 sin detalle", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    getProductosPorIds.mockRejectedValue(new Error("detalle interno"));
    const res = await pedir("?ids=1");
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("detalle interno");
    log.mockRestore();
  });
});
