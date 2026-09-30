import { beforeEach, describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";

const identidad = vi.fn();
const idPriceListCliente = vi.fn();
const getProductosPorIds = vi.fn();
const permitir = vi.fn();
vi.mock("@/lib/auth", () => ({
  identidadActual: () => identidad(),
  idPriceListCliente: (...a: unknown[]) => idPriceListCliente(...a),
}));
vi.mock("@/lib/catalog", () => ({ getProductosPorIds: (...a: unknown[]) => getProductosPorIds(...a) }));
vi.mock("@/lib/rate-limit", () => ({ permitir: (...a: unknown[]) => permitir(...a) }));
const disponibles = vi.fn(async () => false);
vi.mock("@/lib/catalogo-atributos-disponibles", () => ({ atributosEstructuradosDisponibles: () => disponibles() }));
vi.mock("@/lib/flags-publicos", () => ({ flagsPublicos: async () => ({ soloVisibles: false, cuotas: false }) }));

import { GET } from "./route";

const pedir = (qs: string) => GET(new Request(`http://localhost/api/chat-ia/productos${qs}`));
const prod = (id: string, precioFinal = 121) => ({ id, name: `P${id}`, brand: "", price: 100, precioFinal, stock: "in" });

beforeEach(() => {
  vi.stubEnv("AI_API_URL", "https://ai.plataforma.example");
  vi.stubEnv("AI_API_KEY", "clave");
  vi.stubEnv("AI_AGENT_ID", "agente-1");
  identidad.mockReset();
  idPriceListCliente.mockReset();
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

  it("visitante ⇒ lista general; respeta el orden pedido y omite los que faltan", async () => {
    getProductosPorIds.mockResolvedValue(new Map([["2", prod("2")], ["1", prod("1")]]));
    const res = await pedir("?ids=1,3,2,1");
    expect(getProductosPorIds).toHaveBeenCalledWith(["1", "3", "2"], {
      idPriceList: undefined,
      soloActivos: true,
      soloVisibles: false,
    });
    expect((await res.json()).map((p: { id: string }) => p.id)).toEqual(["1", "2"]);
    expect(idPriceListCliente).not.toHaveBeenCalled();
  });

  it("cliente vinculado ⇒ su lista de precios, sacada de la sesión", async () => {
    identidad.mockResolvedValue({ clerkUserId: "u", cliente: { codigocliente: "42" } });
    idPriceListCliente.mockResolvedValue("lista-7");
    getProductosPorIds.mockResolvedValue(new Map());
    await pedir("?ids=1&idPriceList=otra");
    expect(idPriceListCliente).toHaveBeenCalledWith("42");
    expect(getProductosPorIds.mock.calls[0][1]).toMatchObject({ idPriceList: "lista-7" });
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
