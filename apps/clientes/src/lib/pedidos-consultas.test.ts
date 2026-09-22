import { getTableColumns } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbGrabadora,
  valoresInsertados,
  type ConsultaGrabada,
} from "@/db/__fixtures__/db-grabadora";
import { orderItems, orders } from "@/db/schema";
import type { Cotizacion } from "./cotizacion";

/**
 * Forma de las consultas de pedidos ahora que el Shop comparte la base con el
 * CRM: todo acceso a `orders` va contra `"shop"."orders"` y lleva el tenant,
 * tanto al leer como al escribir. Se ejecutan las funciones reales contra un
 * cliente de drizzle que graba el SQL en vez de conectarse.
 */

let grabadora = dbGrabadora();
vi.mock("@/db", () => ({ getDb: () => grabadora.db }));

import {
  cancelarPedidoPendiente,
  crearPedido,
  getPedido,
  getPedidoParaPago,
  getPedidoPorClave,
  listarPedidos,
  pedidoPendienteMasReciente,
  pedidoPorReferencia,
  registrarCobro,
  registrarIntentoFallido,
  resumenPedidos,
  type DatosPedido,
} from "./pedidos";

const DUENO = { clerkUserId: "user_1", clienteCodigo: "C-1" };
const ID = "00000000-0000-4000-8000-000000000001";

/** La consulta pega al esquema `shop` y filtra por el tenant del entorno. */
function esperaTenant(c: ConsultaGrabada, tenant = "tenant-a") {
  expect(c.sql).toContain('"shop"."orders"');
  expect(c.sql).toMatch(/"orders"\."tenant_id" = \$\d+/);
  const n = Number(c.sql.match(/"orders"\."tenant_id" = \$(\d+)/)![1]);
  expect(c.params[n - 1]).toBe(tenant);
}

const cotizacion = {
  lineas: [
    {
      id: "7",
      code: "LAM-1",
      name: "Lámpara",
      brand: null,
      qty: 2,
      precioUnitario: 100,
      total: 200,
    },
  ],
  hayProblemas: false,
  subtotal: 165.29,
  iva: 34.71,
  costoEnvio: 0,
  total: 200,
} as unknown as Cotizacion;

const datos: DatosPedido = {
  contactoNombre: "Ana",
  contactoTelefono: "123",
  entregaTipo: "retiro",
  pagoMetodo: "transferencia",
  idempotencyKey: "clave-1",
};

beforeEach(() => {
  grabadora = dbGrabadora();
  vi.stubEnv("SHOP_TENANT_ID", "tenant-a");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("lecturas de Mis compras: dueño + tenant", () => {
  it("listarPedidos", async () => {
    await listarPedidos(DUENO);
    esperaTenant(grabadora.consultas[0]);
    expect(grabadora.consultas[0].sql).toContain('"orders"."clerk_user_id" =');
  });

  it("getPedido (detalle)", async () => {
    expect(await getPedido(ID, DUENO)).toBeNull();
    esperaTenant(grabadora.consultas[0]);
  });

  it("getPedidoPorClave (atajo de idempotencia)", async () => {
    await getPedidoPorClave("clave-1", DUENO);
    esperaTenant(grabadora.consultas[0]);
    expect(grabadora.consultas[0].sql).toContain('"orders"."idempotency_key" =');
  });

  it("resumenPedidos (tarjeta de Mi cuenta)", async () => {
    await resumenPedidos(DUENO);
    esperaTenant(grabadora.consultas[0]);
  });

  it("getPedidoParaPago", async () => {
    await getPedidoParaPago(ID, DUENO);
    esperaTenant(grabadora.consultas[0]);
  });

  it("pedidoPendienteMasReciente (rescate del checkout)", async () => {
    await pedidoPendienteMasReciente(DUENO);
    esperaTenant(grabadora.consultas[0]);
  });

  it("el tenant sale del entorno en cada consulta", async () => {
    vi.stubEnv("SHOP_TENANT_ID", "tenant-b");
    await listarPedidos(DUENO);
    esperaTenant(grabadora.consultas[0], "tenant-b");
  });

  it("un dueño vacío sigue sin ver nada, con o sin tenant", async () => {
    await listarPedidos({ clerkUserId: null });
    esperaTenant(grabadora.consultas[0]);
    expect(grabadora.consultas[0].sql).toMatch(/and false/);
  });

  it("sin SHOP_TENANT_ID no se consulta nada", async () => {
    vi.stubEnv("SHOP_TENANT_ID", "  ");
    await expect(listarPedidos(DUENO)).rejects.toThrow(/SHOP_TENANT_ID/);
    expect(grabadora.consultas).toHaveLength(0);
  });
});

describe("el motivo interno de cancelación no llega al cliente", () => {
  it("armarOrder no lo serializa aunque la fila lo traiga", async () => {
    const MOTIVO = "Sin stock del proveedor";
    // Una fila completa de `orders`, en el orden de columnas del schema.
    const fila = Object.entries(getTableColumns(orders)).map(([clave, col]) => {
      if (clave === "cancelacionMotivo") return MOTIVO;
      if (clave === "estado") return "cancelado";
      if (col.dataType === "date") return "2026-01-01T00:00:00.000Z";
      if (col.dataType === "number") return 1000;
      if (col.dataType === "boolean") return false;
      if (col.dataType === "json") return null;
      return "x";
    });
    grabadora = dbGrabadora((c) =>
      c.sql.includes('from "shop"."orders"') ? [fila] : [],
    );

    const pedido = await getPedido(ID, DUENO);
    expect(pedido?.estado).toBe("cancelado");
    expect(JSON.stringify(pedido)).not.toContain(MOTIVO);

    const lista = await listarPedidos(DUENO);
    expect(lista).toHaveLength(1);
    expect(JSON.stringify(lista)).not.toContain(MOTIVO);
  });
});

describe("crearPedido", () => {
  it("sella tenant_id desde el entorno, no desde los datos recibidos", async () => {
    grabadora = dbGrabadora((c) =>
      c.sql.startsWith('insert into "shop"."orders"') ? [[ID, 1000, null]] : [],
    );
    // Un body malicioso podría traer `tenantId`: aunque llegara hasta acá, no
    // tiene que influir en lo que se guarda.
    const conTenantAjeno = { ...datos, tenantId: "tenant-b" } as DatosPedido;

    await crearPedido({ clerkUserId: "user_1" }, conTenantAjeno, cotizacion);

    const insert = grabadora.consultas[0];
    const valores = valoresInsertados(insert);
    expect(valores.tenant_id).toBe("tenant-a");
    expect(insert.params).not.toContain("tenant-b");
  });

  it("un pedido nuevo nace sin auditoría ni motivo de cancelación", async () => {
    grabadora = dbGrabadora((c) =>
      c.sql.startsWith('insert into "shop"."orders"') ? [[ID, 1000, null]] : [],
    );
    await crearPedido({ clerkUserId: "user_1" }, datos, cotizacion);

    const valores = valoresInsertados(grabadora.consultas[0]);
    // "default" sobre columnas sin default declarado = NULL en la base.
    expect(valores.cancelacion_motivo).toBe("default");
    expect(valores.estado_actualizado_en).toBe("default");
    expect(valores.estado_actualizado_por).toBe("default");
    expect(valores.estado_actualizado_por_nombre).toBe("default");
    expect(valores.estado).toBe("default");
  });

  it("el re-select del reintento idempotente también filtra por tenant", async () => {
    // El insert no devuelve fila (chocó la clave) y el select tampoco encuentra
    // nada: así se llega al re-select sin fabricar un pedido.
    await expect(
      crearPedido({ clerkUserId: "user_1" }, datos, cotizacion),
    ).rejects.toThrow("Conflicto de idempotencia");

    const reselect = grabadora.consultas[1];
    expect(reselect.sql).toMatch(/^select/);
    esperaTenant(reselect);
  });

  it("sin SHOP_TENANT_ID no inserta nada", async () => {
    vi.stubEnv("SHOP_TENANT_ID", undefined as unknown as string);
    await expect(
      crearPedido({ clerkUserId: "user_1" }, datos, cotizacion),
    ).rejects.toThrow(/SHOP_TENANT_ID/);
    expect(grabadora.consultas).toHaveLength(0);
  });
});

describe("escrituras del flujo de pago", () => {
  const cobro = {
    proveedor: "mercadopago",
    referencia: "ref-1",
    estado: "pagado" as const,
    detalle: "accredited",
  };

  it("registrarCobro: el lock y el update llevan tenant", async () => {
    grabadora = dbGrabadora((c) =>
      c.sql.startsWith("select") ? [["pendiente"]] : [],
    );
    expect(await registrarCobro(ID, cobro)).toBe(true);

    const [lock, update] = grabadora.consultas;
    expect(lock.sql).toContain("for update");
    esperaTenant(lock);
    expect(update.sql).toMatch(/^update "shop"\."orders"/);
    esperaTenant(update);
  });

  it("registrarIntentoFallido", async () => {
    await registrarIntentoFallido(ID, "timeout");
    expect(grabadora.consultas[0].sql).toMatch(/^update "shop"\."orders"/);
    esperaTenant(grabadora.consultas[0]);
  });

  it("pedidoPorReferencia (webhook)", async () => {
    await pedidoPorReferencia("ref-1");
    esperaTenant(grabadora.consultas[0]);
    expect(grabadora.consultas[0].sql).toContain('"orders"."pago_referencia" =');
  });
});

describe("cancelarPedidoPendiente (lo dispara el cliente)", () => {
  it("solo cancela desde estado pendiente, y del tenant actual", async () => {
    await cancelarPedidoPendiente(ID, DUENO);
    const { sql, params } = grabadora.consultas[0];
    const where = sql.slice(sql.indexOf(" where "));

    expect(sql).toMatch(/^update "shop"\."orders"/);
    esperaTenant(grabadora.consultas[0]);

    const estado = where.match(/"orders"\."estado" = \$(\d+)/);
    const pago = where.match(/"orders"\."pago_estado" = \$(\d+)/);
    expect(estado, "falta el filtro por estado").not.toBeNull();
    expect(pago, "falta el filtro por pago_estado").not.toBeNull();
    expect(params[Number(estado![1]) - 1]).toBe("pendiente");
    expect(params[Number(pago![1]) - 1]).toBe("pendiente");
  });

  it("deja el motivo de sistema y la auditoría, sin usuario del admin", async () => {
    const antes = Date.now();
    await cancelarPedidoPendiente(ID, DUENO);
    const { sql, params } = grabadora.consultas[0];
    const set = sql.slice(0, sql.indexOf(" where "));

    const valorDe = (columna: string) => {
      const m = set.match(new RegExp(`"${columna}" = (\\$(\\d+)|null)`));
      expect(m, `el SET no toca ${columna}`).not.toBeNull();
      return m![2] ? params[Number(m![2]) - 1] : null;
    };

    expect(valorDe("estado")).toBe("cancelado");
    expect(valorDe("cancelacion_motivo")).toBe("Cancelado por el cliente.");
    expect(valorDe("estado_actualizado_por_nombre")).toBe("Cliente");
    expect(valorDe("estado_actualizado_por")).toBeNull();
    const en = new Date(valorDe("estado_actualizado_en") as string).getTime();
    expect(en).toBeGreaterThanOrEqual(antes - 1000);
    expect(en).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("si no cambió ninguna fila devuelve false (la ruta contesta el 404 de siempre)", async () => {
    expect(await cancelarPedidoPendiente(ID, DUENO)).toBe(false);
  });

  it("si cambió, true", async () => {
    grabadora = dbGrabadora(() => [[ID]]);
    expect(await cancelarPedidoPendiente(ID, DUENO)).toBe(true);
  });
});

/**
 * Fila cruda de una tabla en el orden de columnas del schema (así las devuelve
 * `pg-proxy`), con valores de relleno salvo los que el test fija.
 */
function filaDe(
  tabla: typeof orders | typeof orderItems,
  valores: Record<string, unknown>,
): unknown[] {
  return Object.entries(getTableColumns(tabla)).map(([clave, col]) => {
    if (clave in valores) return valores[clave];
    if (col.dataType === "date") return "2026-01-01T00:00:00.000Z";
    if (col.dataType === "number") return 1000;
    if (col.dataType === "boolean") return false;
    if (col.dataType === "json") return null;
    return "x";
  });
}

/** Ids del `in (...)` de la consulta a `catalog_products`, en orden. */
function idsConsultados(c: ConsultaGrabada): unknown[] {
  const m = c.sql.match(/"catalog_products"\."alegra_id" in \(([^)]*)\)/);
  expect(m, c.sql).not.toBeNull();
  return m![1].split(", ").map((t) => c.params[Number(t.slice(1)) - 1]);
}

describe("líneas con el nombre real del espejo, sin N+1", () => {
  const PEDIDOS = ["p-1", "p-2", "p-3"];

  function responder(lineas: unknown[][]) {
    return (c: ConsultaGrabada) => {
      if (c.sql.includes('from "shop"."order_items"')) return lineas;
      if (c.sql.includes('from "shop"."orders"')) {
        return PEDIDOS.map((id) => filaDe(orders, { id }));
      }
      return [];
    };
  }

  it("listarPedidos: pedidos, líneas y UNA consulta de productos con ids sin repetir", async () => {
    // 40 líneas repartidas en 3 pedidos, sobre 5 productos distintos.
    const lineas = Array.from({ length: 40 }, (_, i) =>
      filaDe(orderItems, { orderId: PEDIDOS[i % 3], alegraItemId: String(i % 5) }),
    );
    grabadora = dbGrabadora(responder(lineas));

    const pedidos = await listarPedidos(DUENO, 3);

    expect(pedidos).toHaveLength(3);
    expect(grabadora.consultas).toHaveLength(3);
    const [cabeceras, detalle, productos] = grabadora.consultas;
    esperaTenant(cabeceras);
    expect(cabeceras.sql).toContain('"orders"."clerk_user_id" =');
    expect(detalle.sql).toContain('"shop"."order_items"');
    expect(productos.sql).toContain('from "shop"."catalog_products"');
    expect(idsConsultados(productos)).toEqual(["0", "1", "2", "3", "4"]);
  });

  it("sin líneas no consulta productos", async () => {
    grabadora = dbGrabadora(responder([]));
    await listarPedidos(DUENO, 3);
    expect(grabadora.consultas).toHaveLength(2);
  });

  it("getPedido: tres consultas y la de productos no filtra por visible", async () => {
    vi.stubEnv("SHOP_CATALOGO_SOLO_VISIBLES", "1");
    grabadora = dbGrabadora((c) => {
      if (c.sql.includes('from "shop"."order_items"')) {
        return [filaDe(orderItems, { orderId: ID, alegraItemId: "42" })];
      }
      if (c.sql.includes('from "shop"."orders"')) return [filaDe(orders, { id: ID })];
      return [];
    });

    expect(await getPedido(ID, DUENO)).not.toBeNull();
    expect(grabadora.consultas).toHaveLength(3);
    esperaTenant(grabadora.consultas[0]);
    expect(idsConsultados(grabadora.consultas[2])).toEqual(["42"]);
    expect(grabadora.consultas[2].sql).not.toContain('"visible"');
    expect(grabadora.consultas[2].sql).not.toContain('"status"');
  });
});
