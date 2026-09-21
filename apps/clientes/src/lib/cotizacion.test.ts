import { describe, expect, it } from "vitest";
import { MAX_LINEAS, normalizarLineas } from "./cotizacion";

/**
 * `normalizarLineas` es la puerta de entrada de todo lo que manda el browser al
 * cotizador. Lo que pase de acá se convierte en llamadas a Alegra y termina en
 * un pedido, así que es el lugar donde se corta la basura.
 */

describe("normalizarLineas", () => {
  it("deja pasar líneas válidas", () => {
    expect(normalizarLineas([{ id: "a", qty: 2 }])).toEqual([{ id: "a", qty: 2 }]);
  });

  it("devuelve vacío si no es un array", () => {
    for (const basura of [null, undefined, "abc", 42, {}]) {
      expect(normalizarLineas(basura)).toEqual([]);
    }
  });

  /**
   * Dos líneas del mismo id romperían la validación de stock: cada una pasaría
   * por separado contra el disponible, y entre las dos se llevarían más de lo
   * que hay.
   */
  it("suma las cantidades de un id repetido en una sola línea", () => {
    expect(normalizarLineas([
      { id: "a", qty: 2 },
      { id: "a", qty: 3 },
    ])).toEqual([{ id: "a", qty: 5 }]);
  });

  it("descarta cantidades no positivas o no numéricas", () => {
    expect(normalizarLineas([
      { id: "a", qty: 0 },
      { id: "b", qty: -5 },
      { id: "c", qty: NaN },
      { id: "d", qty: "muchas" },
      { id: "e", qty: Infinity },
    ])).toEqual([]);
  });

  it("descarta líneas sin id", () => {
    expect(normalizarLineas([
      { id: "", qty: 1 },
      { qty: 1 },
      { id: "   ", qty: 1 },
    ])).toEqual([]);
  });

  it("trunca los decimales hacia abajo", () => {
    expect(normalizarLineas([{ id: "a", qty: 2.9 }])).toEqual([{ id: "a", qty: 2 }]);
    // 0.5 baja a 0 y por lo tanto se descarta: no se puede pedir media unidad.
    expect(normalizarLineas([{ id: "a", qty: 0.5 }])).toEqual([]);
  });

  it("topea la cantidad por línea", () => {
    const [linea] = normalizarLineas([{ id: "a", qty: 999_999_999 }]);
    expect(linea.qty).toBeLessThanOrEqual(9_999);
  });

  it("topea la cantidad de líneas distintas", () => {
    const muchas = Array.from({ length: MAX_LINEAS + 40 }, (_, i) => ({
      id: `item-${i}`,
      qty: 1,
    }));
    expect(normalizarLineas(muchas)).toHaveLength(MAX_LINEAS);
  });

  it("acota el fan-out contra Alegra incluso con miles de líneas basura", () => {
    const ruido = Array.from({ length: 5_000 }, (_, i) => ({ id: `x-${i}`, qty: 1 }));
    expect(normalizarLineas(ruido).length).toBeLessThanOrEqual(MAX_LINEAS);
  });

  it("normaliza el id a string y le saca los espacios", () => {
    expect(normalizarLineas([{ id: "  a  ", qty: 1 }])).toEqual([{ id: "a", qty: 1 }]);
  });
});

// ---------------------------------------------------------------------------

import { afterEach, vi } from "vitest";
import { cotizarItem } from "./cotizacion";
import { stockSimulado } from "./stock-simulado";
import type { AlegraItem } from "./alegra";

/**
 * Simulación de stock para poder recorrer la tienda sin acceso a Alegra.
 *
 * Hoy los 2818 ítems de la cuenta tienen `availableQuantity: 0`, así que sin
 * esto el flujo de compra no se puede probar ni una vez. La contracara: si se
 * cuela a producción, el shop vende lo que no tiene.
 */
describe("stockSimulado — las dos llaves", () => {
  // `vi.stubEnv` y no asignación directa: los tipos de Node marcan estos como
  // read-only, y escribirlos a mano rompe `tsc` aunque el test pase.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("apagado por defecto", () => {
    vi.stubEnv("VERCEL_ENV", undefined);
    vi.stubEnv("SHOP_STOCK_SIMULADO", undefined);
    expect(stockSimulado()).toBe(false);
  });

  it("se enciende en local con la variable explícita (VERCEL_ENV undefined)", () => {
    vi.stubEnv("VERCEL_ENV", undefined);
    vi.stubEnv("SHOP_STOCK_SIMULADO", "1");
    expect(stockSimulado()).toBe(true);
  });

  /**
   * El motivo por el que se cambió de NODE_ENV a VERCEL_ENV: en Preview de
   * Vercel `NODE_ENV === "production"` (compilación de release), y eso
   * bloqueaba el mock justo cuando más se necesita, que es probar la rama
   * deployada.
   */
  it("se enciende en Preview de Vercel", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("SHOP_STOCK_SIMULADO", "1");
    expect(stockSimulado()).toBe(true);
  });

  /**
   * LA GARANTÍA QUE IMPORTA. Olvidarse la variable cargada en Vercel no puede
   * hacer que el shop venda lo que no tiene.
   */
  it("NO se enciende en producción, aunque la variable esté", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SHOP_STOCK_SIMULADO", "1");
    vi.stubEnv("SHOP_STOCK_SIMULADO_EN_PRODUCCION", undefined);
    expect(stockSimulado()).toBe(false);
  });

  /**
   * Opt-in explícito para producción. Existe mientras el sitio no está abierto
   * y Alegra no tiene inventario: sin esto no se puede probar el checkout
   * deployado. Requiere DOS envs distintas para que activarlo por accidente sea
   * imposible.
   */
  it("se enciende en producción SOLO con el opt-in explícito", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SHOP_STOCK_SIMULADO", "1");
    vi.stubEnv("SHOP_STOCK_SIMULADO_EN_PRODUCCION", "1");
    expect(stockSimulado()).toBe(true);
  });

  it("el opt-in por sí solo no alcanza — falta la variable base", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SHOP_STOCK_SIMULADO", undefined);
    vi.stubEnv("SHOP_STOCK_SIMULADO_EN_PRODUCCION", "1");
    expect(stockSimulado()).toBe(false);
  });

  it("no se activa con cualquier valor", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    for (const v of ["true", "si", "0", "", "yes"]) {
      vi.stubEnv("SHOP_STOCK_SIMULADO", v);
      expect(stockSimulado(), v).toBe(false);
    }
  });
});

describe("cotizarItem con simulación de stock", () => {
  const item = (cantidad: number | null) =>
    ({
      id: "1",
      name: "Panel LED",
      status: "active",
      price: [{ idPriceList: "1", price: 1000, main: true }],
      inventory: cantidad === null ? undefined : { availableQuantity: cantidad },
    }) as unknown as AlegraItem;

  it("sin simular, un ítem en cero queda sin stock", () => {
    const linea = cotizarItem({ id: "1", qty: 2 }, item(0), undefined, false);
    expect(linea.problema).toBe("sin_stock");
  });

  it("simulando, ese mismo ítem se puede comprar", () => {
    const linea = cotizarItem({ id: "1", qty: 2 }, item(0), undefined, true);
    expect(linea.problema).toBeUndefined();
    // Se trata como no inventariable, igual que un servicio: no se inventa una
    // cantidad, se dice "no aplica".
    expect(linea.stockDisponible).toBeNull();
  });

  it("simulando, el precio y el IVA siguen siendo los reales", () => {
    const linea = cotizarItem({ id: "1", qty: 2 }, item(0), undefined, true);
    expect(linea.precioUnitario).toBeGreaterThan(0);
    expect(linea.subtotal).toBe(linea.precioUnitario * 2);
  });

  /** La simulación es de stock, no de catálogo: un inactivo sigue bloqueado. */
  it("simulando, un producto inactivo SIGUE bloqueado", () => {
    const inactivo = { ...item(0), status: "inactive" } as unknown as AlegraItem;
    expect(cotizarItem({ id: "1", qty: 1 }, inactivo, undefined, true).problema).toBe("inactivo");
  });

  it("simulando, un producto sin precio SIGUE bloqueado", () => {
    const sinPrecio = { ...item(0), price: [] } as unknown as AlegraItem;
    expect(cotizarItem({ id: "1", qty: 1 }, sinPrecio, undefined, true).problema).toBe("sin_precio");
  });

  it("no toca el stock real cuando lo hay", () => {
    const linea = cotizarItem({ id: "1", qty: 2 }, item(50), undefined, true);
    expect(linea.stockDisponible).toBe(50);
    expect(linea.problema).toBeUndefined();
  });
});
