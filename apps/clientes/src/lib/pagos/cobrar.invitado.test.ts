import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANONIMO, PA, describirMatrizAislamiento, pedido, tokenDe } from "@/test/aislamiento-invitado";
import { setFlag } from "@/test/flags";
import type { DuenoPedidos, PedidoParaPago } from "@/lib/pedidos";
import type { ProveedorPago } from "./tipos";

/**
 * Cobro con tarjeta (`POST /api/pagos/mercadopago` y `POST /api/pagos/[proveedor]`, ambas por
 * `cobrarPedido`) para el invitado: matriz de aislamiento + antifraude derivado del pedido.
 */

const { identidadActual, permitirAsync, repoLlamadas, crearPago, getItemsParaAntifraude, estadoPedido } = vi.hoisted(() => ({
  identidadActual: vi.fn(),
  permitirAsync: vi.fn(),
  repoLlamadas: [] as DuenoPedidos[],
  crearPago: vi.fn(),
  getItemsParaAntifraude: vi.fn(),
  estadoPedido: { pagoEstado: "pagado" as string },
}));
const falsos = vi.hoisted(() => new Map<string, import("./tipos").ProveedorPago>());

vi.mock("@/lib/auth", () => ({ identidadActual }));
vi.mock("@/lib/rate-limit", () => ({ permitirAsync }));
vi.mock("@/lib/medios-pago-repo", () => ({
  leerMediosPagoTolerante: async () => [{ slug: "mercadopago" }, { slug: "payway" }],
}));
vi.mock("@/lib/pedidos", async (original) => {
  const real = await original<typeof import("@/lib/pedidos")>();
  return {
    motivoNoCobrable: real.motivoNoCobrable,
    getPedidoParaPago: async (id: string, dueno: DuenoPedidos) => {
      repoLlamadas.push(dueno);
      if (!(await import("@/test/aislamiento-invitado")).abre(id, dueno)) return null;
      return {
        id,
        numero: "PED-1",
        total: 100,
        pagoEstado: estadoPedido.pagoEstado as PedidoParaPago["pagoEstado"],
        pagoMetodo: "payway",
        clienteEmail: "comprador@cliente.example",
        facturacionTipoDoc: null,
        facturacionNroDoc: null,
        cuotas: 1,
        estado: "pendiente",
        creadoEn: new Date(),
        contactoNombre: "Ana Gomez",
        contactoTelefono: "2235550100",
        entregaTipo: "retiro",
        entregaCiudad: null,
        entregaDireccion: null,
        facturacionDomicilio: null,
      } satisfies Partial<PedidoParaPago>;
    },
    getItemsParaAntifraude: (...a: unknown[]) => getItemsParaAntifraude(...a),
    reservarIntento: async () => ({ intentoId: "i1" }),
    registrarCobro: async () => true,
    registrarIntentoFallido: async () => undefined,
    registrarErrorIntento: async () => undefined,
    fijarReferenciaIntento: async () => undefined,
    cerrarIntentoSinPago: async () => undefined,
  };
});
vi.mock("./intento-abierto", () => ({ resolverIntentoAbierto: async () => "en_curso" }));
vi.mock("@/lib/pagos", async (orig) => ({
  ...(await orig<typeof import("@/lib/pagos")>()),
  proveedorPago: (id: string, cuenta: string) => {
    const p = falsos.get(id);
    return p ? { ...p, cuenta } : null;
  },
  rasgosProcesador: (id: string) => {
    const p = falsos.get(id);
    return p ? { requiereBin: false, requiereAntifraude: Boolean(p.requiereAntifraude), conWebhook: false } : null;
  },
}));
vi.mock("./credenciales", async (orig) => ({
  ...(await orig<typeof import("./credenciales")>()),
  hayCuentaConfigurada: () => true,
}));
vi.mock("./cuentas-sucursales", () => ({
  cuentaParaCobrar: async () => ({ ok: true, cuenta: "igz", prevista: "igz", fallback: false }),
  proveedorDeIntento: async () => null,
}));

import { cobrarPedido } from "./cobrar";

// El id del procesador es el del medio del pedido ("payway"): así el medio coincide con el procesador.
const payway: ProveedorPago = {
  id: "payway",
  cuenta: "igz",
  requiereAntifraude: true,
  configurado: () => true,
  crearPago: (...a: unknown[]) => crearPago(...a),
  consultarPago: async () => {
    throw new Error("no se usa");
  },
  cancelarPago: async () => {
    throw new Error("no se usa");
  },
};

function cobrar(token: string | null, pedidoId: string, extra: Record<string, unknown> = {}, tokenEnCuerpo = false) {
  falsos.set("payway", payway);
  return cobrarPedido(
    "payway",
    pedido("/api/pagos/payway", { token, tokenEnCuerpo, cuerpo: { pedidoId, token: "token-de-tarjeta", cuotas: 1, ...extra } }),
  );
}

beforeEach(() => {
  estadoPedido.pagoEstado = "pagado";
  crearPago.mockReset();
  crearPago.mockResolvedValue({ estado: "pagado", referencia: "r1", detalle: "ok" });
  getItemsParaAntifraude.mockReset();
  getItemsParaAntifraude.mockResolvedValue([{ id: "i1", nombre: "Lámpara", cantidad: 1, precio: 100 }]);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describirMatrizAislamiento({
  nombre: "POST /api/pagos/mercadopago y /api/pagos/[proveedor] (cobrarPedido)",
  identidad: identidadActual,
  permitir: permitirAsync,
  repoLlamadas,
  conCuerpo: true,
  llamar: ({ token, pedidoId, tokenEnCuerpo }) => cobrar(token, pedidoId, {}, tokenEnCuerpo),
  esFeliz: async (r) => {
    // Pedido ya pagado: llegó hasta la última barrera contra el doble cobro, sin llamar al procesador.
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ estado: "pagado", yaEstaba: true });
    expect(crearPago).not.toHaveBeenCalled();
  },
});

describe("cobrarPedido: antifraude del invitado", () => {
  beforeEach(() => {
    vi.stubEnv("PEDIDO_LINK_SECRET", "secreto-de-prueba-pedido-link-0123456789");
    vi.stubEnv("SHOP_TENANT_ID", "tenant-a.example");
    setFlag("compra-invitado", true);
    identidadActual.mockResolvedValue(ANONIMO);
    permitirAsync.mockResolvedValue(true);
    estadoPedido.pagoEstado = "pendiente";
  });

  it("el identificador es `inv-<pedido>`, los días en el sitio 0 y el email el del pedido", async () => {
    const r = await cobrar(tokenDe(PA), PA);
    expect(r.status).toBe(200);
    const datos = crearPago.mock.calls[0][0];
    expect(datos.antifraude).toMatchObject({
      clienteId: `inv-${PA}`,
      email: "comprador@cliente.example",
      diasEnSitio: 0,
      nombre: "Ana Gomez",
    });
    expect(datos.emailComprador).toBe("comprador@cliente.example");
    // El cobro se aplica sólo a SU pedido, con el monto del pedido (nunca del body).
    expect(datos).toMatchObject({ pedidoId: PA, monto: 100 });
  });

  it("el monto nunca sale del body", async () => {
    await cobrar(tokenDe(PA), PA, { monto: 1, total: 1 });
    expect(crearPago.mock.calls[0][0].monto).toBe(100);
  });

  it("dos pedidos de invitado no comparten identificador de antifraude", async () => {
    await cobrar(tokenDe(PA), PA);
    expect(crearPago.mock.calls[0][0].antifraude.clienteId).toBe(`inv-${PA}`);
    expect(crearPago.mock.calls[0][0].antifraude.clienteId).not.toContain("user_");
  });

  it("quien tiene sesión conserva su identificador de siempre (la cuenta, no inv-)", async () => {
    identidadActual.mockResolvedValue({ clerkUserId: "user_ana", cliente: null, email: "ana@cliente.example", registradoEn: Date.now() - 3 * 86_400_000 });
    const { PC } = await import("@/test/aislamiento-invitado");
    await cobrar(null, PC);
    const datos = crearPago.mock.calls[0][0];
    expect(datos.antifraude.clienteId).toBe("user_ana");
    expect(datos.antifraude.diasEnSitio).toBe(3);
  });

  it("sin email en el pedido (no pasa con un invitado) corta sin cobrar", async () => {
    // El pedido de invitado siempre lleva email; si faltara, el control de fraude lo frena como a cualquiera.
    getItemsParaAntifraude.mockResolvedValue([]);
    const r = await cobrar(tokenDe(PA), PA);
    expect(r.status).toBe(422);
    expect(crearPago).not.toHaveBeenCalled();
  });
});
