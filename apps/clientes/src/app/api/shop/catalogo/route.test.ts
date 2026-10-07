import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/data/products";
import { setFlag } from "@/test/flags";

/**
 * GET /api/shop/catalogo (autocompletar del buscador y destacados del home): fija la forma del
 * JSON y la SECUENCIA de lecturas (plan → exacta → tolerante) sin depender de qué función del
 * catálogo la hace: cada lectura se etiqueta por lo que busca (`etapa`), venga de `getCatalogo`
 * (como antes de la fachada) o de `getPaginaCatalogo` (con el motor).
 */
const prod = (id: string) => ({ id, name: `Producto ${id}`, price: 100, stock: "in" }) as unknown as Product;

type Etapa = "codigo" | "plan" | "exacta" | "tolerante";
const secuencia: Etapa[] = [];
const respuestas: Record<Etapa, Product[]> = { codigo: [], plan: [], exacta: [], tolerante: [] };
/** El texto de cada lectura (para ver qué conserva la tolerante). */
const textos: Texto[] = [];
/** El filtro de stock de cada lectura. */
const stocks: (boolean | undefined)[] = [];
const fallan = new Set<Etapa>();

function leer(etapa: Etapa): Product[] {
  secuencia.push(etapa);
  if (fallan.has(etapa)) throw new Error(`falló ${etapa}`);
  return respuestas[etapa];
}

type Texto = { q?: string; tolerante?: boolean; plan?: unknown; codigo?: boolean };
vi.mock("@/lib/catalog", () => ({
  getPaginaCatalogo: async (o: { filtros?: { texto?: Texto; soloStock?: boolean } }) => {
    const t: Texto = o.filtros?.texto ?? {};
    textos.push(t);
    stocks.push(o.filtros?.soloStock);
    // Con la cascada la tolerante puede llevar plan y código: manda `tolerante`.
    const productos = leer(t.tolerante ? "tolerante" : t.plan ? "plan" : t.codigo ? "codigo" : "exacta");
    return { productos, total: productos.length, pagina: 1, paginas: 1 };
  },
  contarCatalogo: async () => 0,
}));
vi.mock("@/lib/flags-publicos", () => ({ flagsPublicos: async () => ({ soloVisibles: true }) }));
vi.mock("@/lib/zona-servidor", () => ({ dispCatalogo: async () => undefined }));
const estructurados = vi.fn(async () => false);
vi.mock("@/lib/catalogo-atributos-disponibles", () => ({ atributosEstructuradosDisponibles: () => estructurados() }));
const plan = {
  version: 1,
  consulta: "panel de interior",
  intencion: "producto",
  duros: { categorias: [], atributos: [] },
  blandos: { categorias: [{ nombre: "Paneles", peso: 0.9 }], atributos: [], terminos: [{ texto: "panel", peso: 1 }] },
  fuente: "deterministico",
};
const planParaPagina = vi.fn<(q: string, o: unknown) => Promise<unknown>>(async () => plan);
vi.mock("@/lib/busqueda-v2/servidor", () => ({ planParaPagina: (q: string, o: unknown) => planParaPagina(q, o) }));

import { GET } from "./route";

const pedir = (qs: string) => GET(new Request(`http://localhost/api/shop/catalogo${qs}`) as never);

beforeEach(() => {
  secuencia.length = 0;
  respuestas.codigo = [];
  respuestas.plan = [];
  respuestas.exacta = [];
  respuestas.tolerante = [];
  textos.length = 0;
  stocks.length = 0;
  fallan.clear();
  planParaPagina.mockClear();
  planParaPagina.mockResolvedValue(plan);
  estructurados.mockResolvedValue(false);
  setFlag("busqueda-ia", true);
});

describe("GET /api/shop/catalogo", () => {
  it("sólo con stock, como el Enter (el catálogo llega con su default): el desplegable y el Enter dan el mismo conjunto", async () => {
    respuestas.plan = [prod("1")];
    await pedir("?q=panel+de+interior&limit=8");
    expect(stocks).toEqual([true]);
  });

  it("devuelve el array de productos tal cual, sin envoltorio", async () => {
    respuestas.plan = [prod("1"), prod("2")];
    const res = await pedir("?q=panel+de+interior&limit=8");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(respuestas.plan);
  });

  it("con busqueda-ia: plan primero; si trae algo, ahí termina", async () => {
    respuestas.plan = [prod("1")];
    respuestas.exacta = [prod("9")];
    await pedir("?q=panel+de+interior");
    expect(secuencia).toEqual(["plan"]);
    expect(planParaPagina).toHaveBeenCalledWith("panel de interior", { soloVisibles: true });
  });

  it("plan sin resultados => exacta; si trae algo, ahí termina", async () => {
    respuestas.exacta = [prod("3")];
    const res = await pedir("?q=panel+de+interior");
    expect(secuencia).toEqual(["plan", "exacta"]);
    expect(await res.json()).toEqual([prod("3")]);
  });

  it("todo vacío => tolerante, y devuelve lo que traiga (o [])", async () => {
    respuestas.tolerante = [prod("4")];
    const res = await pedir("?q=lampra");
    expect(secuencia).toEqual(["plan", "exacta", "tolerante"]);
    expect(await res.json()).toEqual([prod("4")]);
    secuencia.length = 0;
    respuestas.tolerante = [];
    expect(await (await pedir("?q=lampra")).json()).toEqual([]);
  });

  it("si la tolerante falla, se devuelve lo exacto (vacío) sin error", async () => {
    fallan.add("tolerante");
    const res = await pedir("?q=lampra");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("si el plan falla, sigue con la exacta", async () => {
    fallan.add("plan");
    respuestas.exacta = [prod("5")];
    const res = await pedir("?q=panel+de+interior");
    expect(secuencia).toEqual(["plan", "exacta"]);
    expect(await res.json()).toEqual([prod("5")]);
  });

  it("sin plan (planParaPagina da null): exacta y tolerante", async () => {
    planParaPagina.mockResolvedValue(null);
    await pedir("?q=lampra");
    expect(secuencia).toEqual(["exacta", "tolerante"]);
  });

  it("busqueda-ia apagado: nunca hay plan", async () => {
    setFlag("busqueda-ia", false);
    respuestas.exacta = [prod("6")];
    const res = await pedir("?q=panel+de+interior");
    expect(planParaPagina).not.toHaveBeenCalled();
    expect(secuencia).toEqual(["exacta"]);
    expect(await res.json()).toEqual([prod("6")]);
  });

  it("sin q: una sola lectura (el catálogo alfabético) y sin plan", async () => {
    respuestas.exacta = [prod("7")];
    const res = await pedir("?limit=5");
    expect(planParaPagina).not.toHaveBeenCalled();
    expect(secuencia).toEqual(["exacta"]);
    expect(await res.json()).toEqual([prod("7")]);
  });

  it("si la exacta falla: 502 con el mensaje de siempre", async () => {
    setFlag("busqueda-ia", false);
    fallan.add("exacta");
    const res = await pedir("?q=foco");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "No se pudo cargar el catálogo" });
  });
});

describe("GET /api/shop/catalogo: la cascada (código, plan, exacta, tolerante)", () => {
  it("la forma del JSON no cambia: array de productos, sin `etapa`", async () => {
    respuestas.plan = [prod("1"), prod("2")];
    const res = await pedir("?q=panel+de+interior&limit=8");
    expect(res.status).toBe(200);
    const cuerpo = await res.json();
    expect(cuerpo).toEqual(respuestas.plan);
    expect(JSON.stringify(cuerpo)).not.toContain("etapa");
  });

  it("con plan: plan, exacta y tolerante CONSERVANDO el plan", async () => {
    respuestas.tolerante = [prod("4")];
    const res = await pedir("?q=panle+de+interior");
    expect(secuencia).toEqual(["plan", "exacta", "tolerante"]);
    expect(textos[2]).toMatchObject({ tolerante: true });
    expect(textos[2].plan).toBeDefined();
    expect(await res.json()).toEqual([prod("4")]);
  });

  it("un código se busca en la etapa código (sin pedir plan) y ahí termina", async () => {
    respuestas.codigo = [prod("8")];
    const res = await pedir("?q=DL18W");
    expect(planParaPagina).not.toHaveBeenCalled();
    expect(secuencia).toEqual(["codigo"]);
    expect(textos[0]).toMatchObject({ q: "DL18W", codigo: true });
    expect(await res.json()).toEqual([prod("8")]);
  });

  it("un código sin coincidencia exacta cae a la tolerante del código", async () => {
    respuestas.tolerante = [prod("9")];
    await pedir("?q=DL-18X");
    expect(secuencia).toEqual(["codigo", "tolerante"]);
    expect(textos[1]).toMatchObject({ tolerante: true, codigo: true });
  });

  it("busqueda-ia apagado manda: sin plan, exacta y tolerante", async () => {
    setFlag("busqueda-ia", false);
    await pedir("?q=lampra");
    expect(planParaPagina).not.toHaveBeenCalled();
    expect(secuencia).toEqual(["exacta", "tolerante"]);
  });

});
