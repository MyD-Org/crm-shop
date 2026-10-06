/**
 * El motor del banco corre la cascada SIN los topes de tiempo de producción: con un plan lento (el
 * banco no tiene caché de planes y está lejos de la base) tiene que usarlo igual, no caer en la
 * exacta. Regresión de la medición de autocompletar (hit@8 39 % con la cascada vs 88,6 % legado).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/data/products";
import type { FiltrosCatalogo } from "@/lib/catalog";

const prod = (id: string) => ({ id, name: id }) as unknown as Product;
const lecturas: string[] = [];
const entender = vi.fn();

vi.mock("@/lib/catalog", () => ({
  PRODUCTOS_POR_PAGINA: 24,
  contarCatalogo: async () => 0,
  getPaginaCatalogo: async (o: { filtros?: FiltrosCatalogo; sinConteo?: boolean }) => {
    const t = o.filtros?.texto;
    const etapa = t?.plan ? "plan" : t?.tolerante ? "tolerante" : "exacta";
    lecturas.push(etapa);
    // Sólo el plan encuentra algo (la AND de "tira led para la cocina" no).
    const productos = etapa === "plan" ? [prod("a"), prod("b")] : [];
    return { productos, total: productos.length, pagina: 1, paginas: 1, totalExacto: !o.sinConteo };
  },
}));
vi.mock("../entender/entender", () => ({ entender: (...a: unknown[]) => entender(...a) }));
vi.mock("../conteo", () => ({ contador: () => async () => 0 }));

import { planVacio, type PlanBusqueda } from "../plan";
import { ejecutarMotor } from "./motor";

const plan = (q: string): PlanBusqueda => ({
  ...planVacio(q),
  blandos: { categorias: [{ nombre: "Tiras", peso: 0.9 }], atributos: [], terminos: [{ texto: "tira", peso: 1 }] },
});

beforeEach(() => {
  vi.useFakeTimers();
  lecturas.length = 0;
  entender.mockReset();
  // El plan tarda 5 s (el tope de producción del autocompletar era 250 ms).
  entender.mockImplementation((q: string) => new Promise((resolver) => setTimeout(() => resolver({ plan: plan(q) }), 5000)));
});
afterEach(() => vi.useRealTimers());

describe("ejecutarMotor: cascada con plan lento", () => {
  for (const superficie of ["autocompletar", "chat", "catalogo"] as const) {
    it(`${superficie}: usa el plan aunque tarde, no cae en la exacta`, async () => {
      const promesa = ejecutarMotor("tira led para la cocina", { arbol: [], jev: null, estructurados: false, politica: "cascada", superficie });
      await vi.advanceTimersByTimeAsync(5000);
      const r = await promesa;
      if (superficie === "catalogo") {
        // /buscar decide con el plan; lo que importa acá es que no quede vacío por tiempo.
        expect(r.etapa).not.toBe("vacio");
      } else {
        expect(r.etapa).toBe("plan");
        expect(r.ids).toEqual(["a", "b"]);
        expect(lecturas).toEqual(["plan"]);
      }
    });
  }
});
