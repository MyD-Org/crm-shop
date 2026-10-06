import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/pedidos con lista privada (change `listas-cuenta-corriente`): el servidor resuelve la
 * lista del comprador desde su sesión (nunca del body), cotiza a su precio neto, IGNORA el medio de
 * pago y las cuotas, congela el id de la lista en el pedido y NO deja confirmar una línea sin precio
 * en su lista ("Consulte").
 */
const crearPedido = vi.fn();
const cotizar = vi.fn();
const listaPrivadaDelComprador = vi.fn();
let cliente: { codigocliente: string; razonsocial: string; cuit: string; origen: string } | null = null;

vi.mock("@/lib/rate-limit", () => ({ permitir: () => true }));
vi.mock("@/lib/pedido-avisos", () => ({ avisarPedidoRecibido: vi.fn(), avisarOperadorPedidoNuevo: vi.fn() }));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: () => {},
}));
vi.mock("@/lib/auth", () => ({
  identidadActual: async () => ({ clerkUserId: "user_1", cliente, email: "ana@cliente.example" }),
}));
vi.mock("@/lib/lista-cuenta-repo", () => ({ listaPrivadaDelComprador: () => listaPrivadaDelComprador() }));
vi.mock("@/lib/cotizacion", async (orig) => ({
  ...(await orig<typeof import("@/lib/cotizacion")>()),
  cotizar: (...a: unknown[]) => cotizar(...a),
}));
vi.mock("@/lib/pedidos", () => ({
  crearPedido: (...a: unknown[]) => crearPedido(...a),
  getPedidoPorClave: async () => null,
  listarPedidos: async () => [],
}));
vi.mock("@/lib/facturacion-db", () => ({
  getPerfilFacturacion: async () => ({ pais: "AR", tipoDoc: "DNI", nroDoc: "1", razonSocial: "X", condicionIva: "CF" }),
  perfilCompleto: () => true,
  guardarTelefonoSiFalta: vi.fn(),
  upsertRespaldoVinculado: vi.fn(),
}));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: () => true }));
vi.mock("@/lib/pagos", () => ({ procesadorConfigurado: () => true }));
vi.mock("@/lib/contacto-pedido-repo", () => ({ contactoDelPedido: async () => null }));
// Facturación desde el espejo del CRM (comprador vinculado): datos completos, sin pasar por Alegra.
vi.mock("@/lib/contactos-espejo", () => ({
  CUENTA_ALEGRA_PRINCIPAL: "principal",
  facturacionEspejo: async () => ({
    alegraId: "42",
    name: "Cliente de Prueba SA",
    identification: "30-71234567-1",
    identificationNorm: "30712345671",
    identificationType: "CUIT",
    identificationNumber: "30-71234567-1",
    ivaCondition: "IVA_RESPONSABLE",
    addressStreet: "Calle Falsa 123",
    addressCity: "Posadas",
    addressProvince: null,
    addressPostalCode: null,
    phonePrimary: "+54 376 4000000",
  }),
  vinculablePorId: async () => null,
  idListaGeneral: async () => null,
}));
vi.mock("@/lib/alegra", async (orig) => ({
  ...(await orig<typeof import("@/lib/alegra")>()),
  getContacto: async () => null,
  actualizarContacto: vi.fn(),
  actualizarObservacionesContacto: vi.fn(),
}));
vi.mock("@/lib/contacto-write-through", () => ({ sincronizarContactoConPerfil: vi.fn() }));

let medios: unknown[] = [];
vi.mock("@/lib/medios-pago-repo", () => ({ leerMediosPagoTolerante: async () => medios }));

import { POST } from "./route";

const medio = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  nombre: slug,
  instrucciones: "",
  activo: true,
  aplicaRetiro: true,
  aplicaEnvio: true,
  cobroOnline: false,
  orden: 0,
  idListaPrecios: null,
  destacarEnCatalogo: false,
  mostrarEnFicha: false,
  ...extra,
});

const post = (extra: Record<string, unknown> = {}) =>
  POST(
    new Request("http://localhost/api/pedidos", {
      method: "POST",
      body: JSON.stringify({
        items: [{ id: "1", qty: 1 }],
        contactoNombre: "Ana",
        contactoTelefono: "+54 376 4000000",
        entregaTipo: "retiro",
        pagoMetodo: "transferencia",
        ...extra,
      }),
    }),
  );

const opciones = (i = 0) =>
  cotizar.mock.calls[i][1] as { idListaMedio?: string; idListaPrivada?: string | null };

const cotizacionOk = {
  lineas: [{ id: "1", qty: 1, precioUnitario: 700 }],
  hayProblemas: false,
  subtotal: 700,
  iva: 147,
  costoEnvio: 0,
  total: 847,
  listaPrivada: true,
};

beforeEach(() => {
  cliente = { codigocliente: "42", razonsocial: "Cliente de Prueba SA", cuit: "30-71234567-1", origen: "vinculacion" };
  medios = [
    medio("transferencia", { idListaPrecios: "9" }),
    medio("mercadopago", { cobroOnline: true, idListaPrecios: "10", condicionesCuotas: [{ cuotas: 3, idListaPrecios: "11" }] }),
  ];
  listaPrivadaDelComprador.mockReset().mockResolvedValue("lista-privada-a");
  cotizar.mockReset().mockResolvedValue(cotizacionOk);
  crearPedido.mockReset().mockResolvedValue({ id: "p1", numero: "PED-1", repetido: false, cuotas: null });
});

describe("POST /api/pedidos con lista privada", () => {
  it("cotiza con la lista privada, ignora la del medio y congela el id de la lista en el pedido", async () => {
    expect((await post()).status).toBe(201);
    expect(opciones().idListaPrivada).toBe("lista-privada-a");
    expect(opciones().idListaMedio).toBeUndefined();
    expect(crearPedido.mock.calls[0][0].idPriceList).toBe("lista-privada-a");
    // Se persiste lo cotizado (neto de su lista), no un recálculo.
    expect(crearPedido.mock.calls[0][2]).toMatchObject({ subtotal: 700, total: 847 });
  });

  it("no hay cuotas con lista privada, aunque el medio las tenga y las pida el body", async () => {
    expect((await post({ pagoMetodo: "mercadopago", cuotas: 3 })).status).toBe(201);
    expect(opciones().idListaMedio).toBeUndefined();
    expect(crearPedido.mock.calls[0][1].cuotas).toBeNull();
  });

  it("la lista nunca viene del body", async () => {
    listaPrivadaDelComprador.mockResolvedValue(null);
    await post({ idListaPrivada: "lista-privada-a", idPriceList: "lista-privada-a", listaId: "lista-privada-a" });
    expect(opciones().idListaPrivada).toBeNull();
    expect(crearPedido.mock.calls[0][0].idPriceList).toBe("9");
  });

  it("sin precio en su lista: 409 en usted, no crea el pedido", async () => {
    cotizar.mockResolvedValue({
      ...cotizacionOk,
      hayProblemas: true,
      lineas: [{ id: "1", qty: 1, precioUnitario: 0, problema: "sin_precio", sinPrecio: true }],
    });
    const r = await post();
    expect(r.status).toBe(409);
    const json = await r.json();
    expect(json.error).toBe("Hay productos sin precio para su cuenta. Quítelos o consulte con un asesor.");
    expect(json.motivo).toBe("sin_precio_cuenta");
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("totalVisto distinto del total de su lista: 409 precio_cambio", async () => {
    const r = await post({ totalVisto: 999 });
    expect(r.status).toBe(409);
    expect((await r.json()).motivo).toBe("precio_cambio");
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("un comprador sin lista privada (contado, sin enlace) conserva el precio por medio", async () => {
    listaPrivadaDelComprador.mockResolvedValue(null);
    await post();
    expect(opciones().idListaPrivada).toBeNull();
    expect(opciones().idListaMedio).toBe("9");
    expect(crearPedido.mock.calls[0][0].idPriceList).toBe("9");
  });

  it("sin cliente vinculado ni consulta la lista privada", async () => {
    cliente = null;
    await post();
    expect(listaPrivadaDelComprador).not.toHaveBeenCalled();
    expect(opciones().idListaPrivada).toBeNull();
  });
});
