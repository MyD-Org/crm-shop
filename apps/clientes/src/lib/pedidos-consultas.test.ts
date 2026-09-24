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
  intentoAbiertoDelPedido,
  getPedido,
  getPedidoParaPago,
  getPedidoPorClave,
  listarPedidos,
  estadoDelPedido,
  motivoNoCobrable,
  pedidoDelPago,
  pedidoPendienteMasReciente,
  registrarCobro,
  registrarIntentoFallido,
  reservarIntento,
  resumenPedidos,
  type DatosPedido,
} from "./pedidos";
import { setFlag } from "@/test/flags";

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

describe("crearPedido vacía el carrito del servidor", () => {
  const nuevo = (c: ConsultaGrabada) =>
    c.sql.startsWith('insert into "shop"."orders"') ? [[ID, 1000, null]] : [];
  const vaciados = () =>
    grabadora.consultas.filter((c) => c.sql.startsWith('update "shop"."carts"'));

  it("pedido nuevo con Clerk: vacía su carrito en la misma transacción, después de las líneas", async () => {
    grabadora = dbGrabadora(nuevo);
    await crearPedido({ clerkUserId: "user_1" }, datos, cotizacion);

    const tablas = grabadora.consultas.map((c) => c.sql.split(" ").slice(0, 3).join(" "));
    expect(tablas).toEqual([
      'insert into "shop"."orders"',
      'insert into "shop"."order_items"',
      'update "shop"."carts" set',
    ]);
    const [u] = vaciados();
    expect(u.params).toContain("[]");
    expect(u.sql).toMatch(/"version" = "shop"\."carts"\."version" \+ 1/);
    const param = (col: string) =>
      u.params[Number(u.sql.match(new RegExp(`"carts"\\."${col}" = \\$(\\d+)`))![1]) - 1];
    expect(param("tenant_id")).toBe("tenant-a");
    expect(param("clerk_user_id")).toBe("user_1");
  });

  it("reintento idempotente (la clave ya existía): NO toca el carrito", async () => {
    grabadora = dbGrabadora((c) =>
      c.sql.startsWith("select") && c.sql.includes('"shop"."orders"') ? [[ID, 1000, null]] : [],
    );
    const r = await crearPedido({ clerkUserId: "user_1" }, datos, cotizacion);
    expect(r.repetido).toBe(true);
    expect(vaciados()).toEqual([]);
  });

  it("cookie del CRM sin Clerk: no hay carrito del servidor que vaciar", async () => {
    grabadora = dbGrabadora(nuevo);
    await crearPedido({ clerkUserId: null }, datos, cotizacion);
    expect(vaciados()).toEqual([]);
  });

  it("si fallan las líneas, el carrito no se toca", async () => {
    grabadora = dbGrabadora((c) => {
      if (c.sql.startsWith('insert into "shop"."order_items"')) throw new Error("falla");
      return nuevo(c);
    });
    await expect(crearPedido({ clerkUserId: "user_1" }, datos, cotizacion)).rejects.toThrow();
    expect(vaciados()).toEqual([]);
  });
});

describe("escrituras del flujo de pago", () => {
  const cobro = {
    proveedor: "mercadopago",
    referencia: "ref-1",
    estado: "pagado" as const,
    detalle: "accredited",
  };

  /** Responde según a qué tabla y con qué forma le pega cada consulta. */
  const responder =
    (r: {
      lock?: string;
      pedido?: string;
      porReferencia?: unknown[];
      reserva?: unknown[];
      todos?: unknown[][];
    }) =>
    (c: ConsultaGrabada) => {
      if (c.sql.includes("for update")) return r.lock ? [[r.lock, r.pedido ?? "pendiente"]] : [];
      if (c.sql.startsWith('insert into "shop"."pago_intentos"')) return [["nuevo", "ref-1", "pendiente"]];
      if (!c.sql.startsWith('select') || !c.sql.includes('from "shop"."pago_intentos"')) return [];
      if (c.sql.includes('"pago_intentos"."referencia" = ')) return r.porReferencia ? [r.porReferencia] : [];
      if (c.sql.includes('"pago_intentos"."referencia" is null')) return r.reserva ? [r.reserva] : [];
      return r.todos ?? [];
    };

  const updateDe = (tabla: string) =>
    grabadora.consultas.find((c) => c.sql.startsWith(`update "shop"."${tabla}"`))!;

  it("registrarCobro: el lock y el update del pedido llevan tenant", async () => {
    grabadora = dbGrabadora(
      responder({
        lock: "pendiente",
        todos: [["nuevo", "ref-1", "pagado", "mercadopago", "accredited", null, null, null]],
      }),
    );
    expect(await registrarCobro(ID, cobro)).toBe(true);

    const lock = grabadora.consultas[0];
    expect(lock.sql).toContain("for update");
    esperaTenant(lock);
    esperaTenant(updateDe("orders"));
    // Pago que la base no conocía: se anota como intento nuevo, con tenant.
    const insert = grabadora.consultas.find((c) => c.sql.startsWith('insert into "shop"."pago_intentos"'))!;
    expect(valoresInsertados(insert).tenant_id).toBe("tenant-a");
  });

  it("registrarCobro: un intento viejo que se aprueba después del reintento deja el pedido pagado", async () => {
    // El caso que perdía la plata: el pedido ya apuntaba al segundo intento
    // (rechazado) y llega la aprobación del primero.
    grabadora = dbGrabadora(
      responder({
        lock: "fallido",
        porReferencia: ["viejo", "ref-viejo", "pendiente"],
        todos: [
          ["viejo", "ref-viejo", "pagado", "mercadopago", "accredited", "tarjeta", 1, "1000.00"],
          ["segundo", "ref-2", "fallido", "mercadopago", "cc_rejected_other_reason", "tarjeta", null, null],
        ],
      }),
    );
    expect(
      await registrarCobro(ID, { ...cobro, referencia: "ref-viejo" }),
    ).toBe(true);

    // No se inserta nada: el intento ya existía.
    expect(grabadora.consultas.some((c) => c.sql.startsWith("insert"))).toBe(false);
    const pedido = updateDe("orders");
    expect(pedido.params).toContain("pagado");
    expect(pedido.params).toContain("ref-viejo");
  });

  it("registrarCobro: el resultado de la ruta completa su propia reserva", async () => {
    grabadora = dbGrabadora(
      responder({
        lock: "pendiente",
        reserva: ["reserva-1", null, "pendiente"],
        todos: [["reserva-1", "ref-1", "pagado", "mercadopago", "accredited", null, null, null]],
      }),
    );
    await registrarCobro(ID, cobro, { intentoId: "reserva-1" });

    expect(grabadora.consultas.some((c) => c.sql.startsWith("insert"))).toBe(false);
    const intento = updateDe("pago_intentos");
    expect(intento.params).toContain("ref-1");
    expect(intento.params).toContain("reserva-1");
  });

  it("registrarCobro: un evento viejo no baja un intento ya cobrado", async () => {
    grabadora = dbGrabadora(
      responder({
        lock: "pagado",
        porReferencia: ["i1", "ref-1", "pagado"],
        todos: [["i1", "ref-1", "pagado", "mercadopago", "accredited", null, null, null]],
      }),
    );
    expect(await registrarCobro(ID, { ...cobro, estado: "pendiente" })).toBe(false);
    expect(updateDe("pago_intentos").sql).not.toContain('"estado" =');
    expect(updateDe("orders").sql).not.toContain('"pago_estado" =');
  });

  /** Valor que el UPDATE del pedido le pone a `pago_revision` (null si va literal). */
  const revisionEscrita = () => {
    const { sql, params } = updateDe("orders");
    const m = sql.match(/"pago_revision" = (\$(\d+)|null)/);
    expect(m, "el update no escribe pago_revision").not.toBeNull();
    return m![2] ? params[Number(m![2]) - 1] : null;
  };

  it("registrarCobro: dos intentos aprobados marcan cobro_duplicado para el CRM", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    grabadora = dbGrabadora(
      responder({
        lock: "pagado",
        porReferencia: ["segundo", "ref-2", "pendiente"],
        todos: [
          ["primero", "ref-1", "pagado", "mercadopago", "accredited", null, null, null],
          ["segundo", "ref-2", "pagado", "mercadopago", "accredited", null, null, null],
        ],
      }),
    );
    await registrarCobro(ID, { ...cobro, referencia: "ref-2" });
    expect(revisionEscrita()).toBe("cobro_duplicado");
  });

  it("registrarCobro: un pago aprobado sobre un pedido cancelado marca pagado_cancelado", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    grabadora = dbGrabadora(
      responder({
        lock: "pendiente",
        pedido: "cancelado",
        porReferencia: ["i1", "ref-1", "pendiente"],
        todos: [["i1", "ref-1", "pagado", "mercadopago", "accredited", null, null, null]],
      }),
    );
    await registrarCobro(ID, cobro);
    expect(revisionEscrita()).toBe("pagado_cancelado");
  });

  it("registrarCobro: con la devolución procesada, la marca se limpia sola", async () => {
    grabadora = dbGrabadora(
      responder({
        lock: "pagado",
        porReferencia: ["segundo", "ref-2", "pagado"],
        todos: [
          ["primero", "ref-1", "pagado", "mercadopago", "accredited", null, null, null],
          ["segundo", "ref-2", "fallido", "mercadopago", "refunded", null, null, null],
        ],
      }),
    );
    await registrarCobro(ID, { ...cobro, referencia: "ref-2", estado: "fallido", reversion: true });
    expect(revisionEscrita()).toBeNull();
  });

  it("reservarIntento: bloquea el pedido y no abre otro si hay uno abierto", async () => {
    const creado = new Date("2026-09-23T12:00:00Z");
    grabadora = dbGrabadora((c) => {
      if (c.sql.includes("for update")) return [[ID, "pendiente"]];
      if (c.sql.startsWith("select")) return [["i1", "mercadopago", "ref-1", creado.toISOString()]];
      return [];
    });
    const r = await reservarIntento(ID, "mercadopago", "tarjeta");
    expect(r).toMatchObject({ abierto: { id: "i1", referencia: "ref-1" } });
    expect(grabadora.consultas[0].sql).toContain("for update");
    esperaTenant(grabadora.consultas[0]);
    expect(grabadora.consultas[1].sql).toContain('"pago_intentos"."tenant_id" =');
    expect(grabadora.consultas.some((c) => c.sql.startsWith("insert"))).toBe(false);
  });

  it("reservarIntento: re-chequea el estado con el lock; un pedido cancelado no abre intento", async () => {
    grabadora = dbGrabadora((c) => (c.sql.includes("for update") ? [[ID, "cancelado"]] : []));
    expect(await reservarIntento(ID, "mercadopago", "tarjeta")).toEqual({ noCobrable: true });
    expect(grabadora.consultas.some((c) => c.sql.startsWith("insert"))).toBe(false);
  });

  it("reservarIntento: sin intentos abiertos, inserta la reserva con tenant", async () => {
    grabadora = dbGrabadora((c) => {
      if (c.sql.includes("for update")) return [[ID, "pendiente"]];
      if (c.sql.startsWith("insert")) return [["nuevo"]];
      return [];
    });
    expect(await reservarIntento(ID, "mercadopago", "tarjeta")).toEqual({ intentoId: "nuevo" });
    const insert = grabadora.consultas.find((c) => c.sql.startsWith("insert"))!;
    expect(valoresInsertados(insert)).toMatchObject({ tenant_id: "tenant-a", order_id: ID, medio: "tarjeta" });
  });

  it("registrarIntentoFallido", async () => {
    await registrarIntentoFallido(ID, "timeout");
    expect(grabadora.consultas[0].sql).toMatch(/^update "shop"\."orders"/);
    esperaTenant(grabadora.consultas[0]);
  });

  it("registrarIntentoFallido con reserva: la cierra solo si no tiene referencia", async () => {
    await registrarIntentoFallido(ID, "400", "reserva-1");
    const reserva = grabadora.consultas[0];
    expect(reserva.sql).toMatch(/^update "shop"\."pago_intentos"/);
    expect(reserva.sql).toContain('"pago_intentos"."referencia" is null');
  });

  it("pedidoDelPago (webhook): busca por intento, después por pedido, con tenant", async () => {
    expect(await pedidoDelPago("mercadopago", "ref-1")).toBeNull();
    const [porIntento, porPedido] = grabadora.consultas;
    expect(porIntento.sql).toContain('from "shop"."pago_intentos"');
    expect(porIntento.sql).toContain('"pago_intentos"."tenant_id" =');
    esperaTenant(porIntento);
    expect(porPedido.sql).toContain('"orders"."pago_referencia" =');
    esperaTenant(porPedido);
    // Sin external_reference no hay tercera búsqueda.
    expect(grabadora.consultas).toHaveLength(2);
  });

  it("pedidoDelPago: el respaldo por external_reference exige un uuid y el tenant", async () => {
    await pedidoDelPago("mercadopago", "ref-1", "../otra-cosa");
    expect(grabadora.consultas).toHaveLength(2);

    grabadora = dbGrabadora();
    await pedidoDelPago("mercadopago", "ref-1", ID);
    const porExterno = grabadora.consultas[2];
    expect(porExterno.sql).toContain('"orders"."id" =');
    expect(porExterno.sql).toContain('"orders"."pago_metodo" =');
    esperaTenant(porExterno);
  });
});

describe("estadoDelPedido", () => {
  it("un intento cobrado alcanza, aunque haya otros caídos o abiertos", () => {
    expect(estadoDelPedido(["fallido", "pagado", "pendiente"])).toBe("pagado");
  });
  it("sin cobrados, uno abierto lo deja pendiente", () => {
    expect(estadoDelPedido(["fallido", "pendiente"])).toBe("pendiente");
  });
  it("todos caídos: fallido", () => {
    expect(estadoDelPedido(["fallido", "fallido"])).toBe("fallido");
  });
  it("sin intentos no opina", () => {
    expect(estadoDelPedido([])).toBeNull();
  });
});

describe("motivoNoCobrable", () => {
  const AHORA = Date.parse("2026-09-23T12:00:00Z");
  const hace = (h: number) => new Date(AHORA - h * 60 * 60_000);

  it("pendiente y reciente: se cobra", () => {
    expect(motivoNoCobrable({ estado: "pendiente", creadoEn: hace(1) }, AHORA)).toBeNull();
  });
  it("cancelado", () => {
    expect(motivoNoCobrable({ estado: "cancelado", creadoEn: hace(1) }, AHORA)).toBe("cancelado");
  });
  it("ya tomado por un operador", () => {
    expect(motivoNoCobrable({ estado: "confirmado", creadoEn: hace(1) }, AHORA)).toBe("en_curso");
  });
  it("más viejo que la ventana de pago", () => {
    expect(motivoNoCobrable({ estado: "pendiente", creadoEn: hace(25) }, AHORA)).toBe("vencido");
  });
});

describe("cancelarPedidoPendiente (lo dispara el cliente)", () => {
  /** Lock del pedido → intentos abiertos → update. */
  const conPedido = (intentoAbierto = false) =>
    dbGrabadora((c) => {
      if (c.sql.includes("for update")) return [[ID]];
      if (c.sql.includes('from "shop"."pago_intentos"')) return intentoAbierto ? [["i1"]] : [];
      return [];
    });

  it("solo cancela desde estado pendiente, del dueño y del tenant actual", async () => {
    grabadora = conPedido();
    await cancelarPedidoPendiente(ID, DUENO);
    const { sql, params } = grabadora.consultas[0];
    const where = sql.slice(sql.indexOf(" where "));

    expect(sql).toContain("for update");
    esperaTenant(grabadora.consultas[0]);
    expect(sql).toContain('"orders"."clerk_user_id" =');

    const estado = where.match(/"orders"\."estado" = \$(\d+)/);
    const pago = where.match(/"orders"\."pago_estado" = \$(\d+)/);
    expect(estado, "falta el filtro por estado").not.toBeNull();
    expect(pago, "falta el filtro por pago_estado").not.toBeNull();
    expect(params[Number(estado![1]) - 1]).toBe("pendiente");
    expect(params[Number(pago![1]) - 1]).toBe("pendiente");

    const update = grabadora.consultas[2];
    expect(update.sql).toMatch(/^update "shop"\."orders"/);
    esperaTenant(update);
  });

  it("deja el motivo de sistema y la auditoría, sin usuario del admin", async () => {
    grabadora = conPedido();
    const antes = Date.now();
    await cancelarPedidoPendiente(ID, DUENO);
    const { sql, params } = grabadora.consultas[2];
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

  it("si el pedido no califica devuelve null y no escribe (la ruta contesta el 404 de siempre)", async () => {
    expect(await cancelarPedidoPendiente(ID, DUENO)).toBeNull();
    expect(grabadora.consultas.some((c) => c.sql.startsWith("update"))).toBe(false);
  });

  it("con un intento de cobro abierto no cancela: pago_en_curso", async () => {
    grabadora = conPedido(true);
    expect(await cancelarPedidoPendiente(ID, DUENO)).toBe("pago_en_curso");
    expect(grabadora.consultas[1].sql).toContain('"pago_intentos"."tenant_id" =');
    expect(grabadora.consultas.some((c) => c.sql.startsWith("update"))).toBe(false);
  });

  it("si cambió, cancelado", async () => {
    grabadora = conPedido();
    expect(await cancelarPedidoPendiente(ID, DUENO)).toBe("cancelado");
  });

  it("intentoAbiertoDelPedido filtra por dueño y tenant", async () => {
    expect(await intentoAbiertoDelPedido(ID, DUENO)).toBeNull();
    const { sql } = grabadora.consultas[0];
    expect(sql).toContain('from "shop"."pago_intentos"');
    expect(sql).toContain('"pago_intentos"."tenant_id" =');
    expect(sql).toContain('"orders"."clerk_user_id" =');
    esperaTenant(grabadora.consultas[0]);
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
    setFlag("catalogo-solo-visibles", true);
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

describe("resumenPedidos: en curso sin importar el año", () => {
  it("el año sólo limita los agregados anuales, no el WHERE ni el conteo en curso", async () => {
    await resumenPedidos(DUENO);
    const { sql } = grabadora.consultas[0];
    esperaTenant(grabadora.consultas[0]);
    expect(sql).toContain('"orders"."clerk_user_id" =');

    const where = sql.slice(sql.indexOf(" where "));
    expect(where).not.toContain('"created_at"');

    // Tres agregados: pedidos del año, en curso (estado, SIN fecha) y
    // comprado del año (sin cancelados).
    const filtros = [...sql.matchAll(/filter \(where (.*?)\)::(int|float8)/g)].map((m) => m[1]);
    expect(filtros).toHaveLength(3);
    const [pedidosDelAnio, enCursoFiltro, comprado] = filtros;
    expect(pedidosDelAnio).toContain('"orders"."created_at" >=');
    expect(enCursoFiltro).toContain('"orders"."estado" in');
    expect(enCursoFiltro).not.toContain('"created_at"');
    expect(comprado).toContain('"orders"."created_at" >=');
    expect(comprado).toContain("<> 'cancelado'");
  });
});
