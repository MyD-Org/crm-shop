import { beforeEach, describe, expect, it, vi } from "vitest";
import { setFlag } from "@/test/flags";
import type { MedioPago } from "@/lib/medios-pago";
import type { DatosSucursales, SucursalVista } from "@/lib/sucursales-repo";
import { VentaSinStockCambioError, type VentaSinStock } from "@/lib/venta-sin-stock";
import { modalidadesActivas } from "@/lib/venta-sin-stock-repo";

/**
 * Venta sin stock por modalidad en POST /api/pedidos (fixtures sintéticas):
 * - El servidor decide qué líneas van a pedido (con el flag `disponibilidad-sucursal`, el motor de
 *   disponibilidad, igual que el carrito) y el flujo del pedido; el navegador sólo manda el medio.
 * - Flujo `a_confirmar` (sin cuenta corriente): sólo `a_coordinar`, cotizado con la lista que
 *   muestran las cards (la del medio destacado), sin cuotas ni forma. Un medio en línea → 409.
 * - Flujo normal: el checkout de siempre (`a_coordinar` con medios aplicables → el 400 de hoy).
 * - Cuenta corriente: sigue con su medio.
 * - La modalidad cambió entre la cotización y la transacción → 409 con la recotización.
 */

const crearPedido = vi.fn();
const cotizar = vi.fn();
const getPedidoPorClave = vi.fn();
const disponibilidadParaMostrar = vi.fn();
const marcarModalidadesCambiadas = vi.fn();
let identidad: Record<string, unknown>;
let medios: MedioPago[];
let estadoDisp = false;

const disp = { zona: "sede-a", activas: ["sede-a", "sede-b"], contarEn: ["sede-a"], stockHeredado: "sede-a" };
const suc = (slug: string, extra: Partial<SucursalVista> = {}): SucursalVista => ({
  slug,
  nombre: slug,
  ciudad: "Ciudad Ejemplo",
  provincia: "Provincia Ejemplo",
  direccion: "Calle Ejemplo 123",
  horario: "Lunes a viernes de 9 a 18",
  aceptaRetiro: true,
  aceptaEnvio: true,
  envioCiudades: [],
  orden: 1,
  activa: true,
  predeterminada: false,
  ...extra,
});
const datosSucursales: DatosSucursales = {
  sucursales: [suc("sede-a"), suc("sede-b", { orden: 2, predeterminada: true })],
  zonas: [{ id: "z1", provinciaClave: "misiones", sucursal: "sede-a", facturaSucursal: null }],
};

vi.mock("@/lib/rate-limit", () => ({ permitirAsync: async () => true }));
vi.mock("@/lib/pedido-avisos", () => ({ avisoOperadorAlCrear: () => true, avisarPedidoSiFalta: vi.fn() }));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: () => {},
}));
vi.mock("@/lib/auth", () => ({ identidadActual: async () => identidad }));
vi.mock("@/lib/lista-cuenta-repo", () => ({ listaPrivadaDelComprador: async () => null }));
vi.mock("@/lib/cotizacion", async (orig) => ({
  ...(await orig<typeof import("@/lib/cotizacion")>()),
  cotizar: (...a: unknown[]) => cotizar(...a),
}));
vi.mock("@/lib/pedidos", () => ({
  crearPedido: (...a: unknown[]) => crearPedido(...a),
  getPedidoPorClave: (...a: unknown[]) => getPedidoPorClave(...a),
  listarPedidos: async () => [],
}));
vi.mock("@/lib/datos-del-contacto", () => ({
  datosDelContacto: async () => ({
    fuente: "perfil",
    vinculado: false,
    alegraId: null,
    datos: { pais: "AR", tipoDoc: "DNI", nroDoc: "1", razonSocial: "Persona Ejemplo", condicionIva: "CF" },
    bloqueados: [],
    faltantes: [],
    completo: true,
    motivoRevision: null,
    tipoDocDeducido: false,
    telefonos: null,
    telefonoAlegra: null,
    perfil: null,
    interno: null,
  }),
}));
vi.mock("@/lib/facturacion-db", () => ({ guardarTelefonoSiFalta: async () => {} }));
vi.mock("@/lib/ubicacion-servidor", () => ({ ubicacionDelVisitante: async () => ({ ubicacion: null }) }));
vi.mock("@/lib/cuotas-flag", () => ({ cuotasHabilitadas: async () => true }));
vi.mock("@/lib/pagos", () => ({ procesadorConfigurado: () => true }));
vi.mock("@/lib/pagos/mp-public-key", () => ({ configMpPara: async () => ({}) }));
vi.mock("@/lib/medios-pago-repo", () => ({ leerMediosPagoTolerante: async () => medios }));
vi.mock("@/lib/contacto-pedido-repo", () => ({ contactoDelPedido: async () => null }));
vi.mock("@/lib/zona-servidor", () => ({ dispDelVisitante: async () => (estadoDisp ? disp : undefined) }));
vi.mock("@/lib/disponibilidad-vista", () => ({
  contextoParaProvincia: async (base: typeof disp) => base,
  disponibilidadParaMostrar: (...a: unknown[]) => disponibilidadParaMostrar(...a),
}));
vi.mock("@/lib/sucursales-datos", () => ({ sucursalesCacheadas: async () => datosSucursales }));
vi.mock("@/lib/cache-invalidar", () => ({
  marcarStockCambiado: () => {},
  marcarModalidadesCambiadas: () => marcarModalidadesCambiadas(),
}));

import { POST } from "./route";

const NO_DISPONIBLE = "Ese medio de pago no está disponible para la entrega elegida.";
const A_CONFIRMAR = "Su pedido incluye productos que se confirman por contacto. Revise el pedido para continuar.";

const medio = (o: Partial<MedioPago>): MedioPago => ({
  slug: "transferencia",
  nombre: "Transferencia",
  instrucciones: "",
  activo: true,
  aplicaRetiro: true,
  aplicaEnvio: true,
  cobroOnline: false,
  orden: 1,
  idListaPrecios: "lista-destacado",
  destacarEnCatalogo: true,
  mostrarEnFicha: false,
  ...o,
});
const MERCADOPAGO = medio({
  slug: "mercadopago",
  nombre: "Mercado Pago",
  cobroOnline: true,
  orden: 2,
  idListaPrecios: "lista-mp",
  destacarEnCatalogo: false,
  condicionesCuotas: [{ cuotas: 3, idListaPrecios: "lista-3", montoMinimo: null, marcas: null }],
});
const CC = medio({
  slug: "efectivo-cheque",
  nombre: "Efectivo o cheque",
  audiencia: "cuenta_corriente",
  idListaPrecios: null,
  destacarEnCatalogo: false,
});

const EN_LINEA: VentaSinStock = { id: "mod-48", texto: "Retiro en ~48 h", plazoDias: 2, flujo: "en_linea" };
const A_PEDIDO: VentaSinStock = { id: "mod-pedido", texto: "A pedido", plazoDias: null, flujo: "a_confirmar" };

const enLinea = { id: "10", qty: 1 };
const aConfirmar = { id: "20", qty: 1 };
const conStock = { id: "30", qty: 1 };

/** Modalidad (activa) que la cotización resuelve para cada id; sin entrada = producto sin modalidad. */
let modalidadDe: Record<string, VentaSinStock> = {};

/**
 * Cotización falsa: cada línea con modalidad va a pedido (sin el flag decide `cotizar`; con el flag,
 * sólo si su id está en `aPedido`). Total = 100 por línea con la lista del destacado, 120 con otra.
 */
const cotizacionFalsa = async (
  lineas: { id: string; qty: number }[],
  o: { idListaMedio?: string; aPedido?: ReadonlySet<string> } = {},
) => {
  const precio = o.idListaMedio === "lista-destacado" ? 100 : 120;
  const cotizadas = lineas.map((l) => {
    const m = modalidadDe[l.id];
    const vaAPedido = m && (o.aPedido ? o.aPedido.has(l.id) : true);
    return {
      id: l.id,
      code: null,
      name: `Producto ${l.id}`,
      brand: "",
      qty: l.qty,
      precioUnitario: precio,
      ivaPorcentaje: 0,
      subtotal: precio * l.qty,
      iva: 0,
      total: precio * l.qty,
      stockDisponible: vaAPedido ? 0 : 5,
      ...(m ? { aceptaSinStock: true } : {}),
      ...(vaAPedido ? { ventaSinStock: m } : {}),
    };
  });
  const total = cotizadas.reduce((a, l) => a + l.total, 0);
  return {
    lineas: cotizadas,
    subtotal: total,
    iva: 0,
    costoEnvio: 0,
    total,
    hayProblemas: false,
    listaPrivada: false,
    flujo: cotizadas.some((l) => l.ventaSinStock?.flujo === "a_confirmar") ? "a_confirmar" : "normal",
  };
};

const post = (body: Record<string, unknown>) =>
  POST(
    new Request("http://localhost/api/pedidos", {
      method: "POST",
      body: JSON.stringify({
        contactoNombre: "Persona Ejemplo",
        contactoTelefono: "0000",
        entregaTipo: "retiro",
        ...body,
      }),
    }),
  );

const listasCotizadas = () => cotizar.mock.calls.map((c) => (c[1] as { idListaMedio?: string }).idListaMedio);

beforeEach(() => {
  identidad = { clerkUserId: "user_1", cliente: null, email: "persona@cliente.example" };
  medios = [medio({}), MERCADOPAGO];
  modalidadDe = { [enLinea.id]: EN_LINEA, [aConfirmar.id]: A_PEDIDO };
  estadoDisp = false;
  cotizar.mockReset();
  cotizar.mockImplementation(cotizacionFalsa);
  getPedidoPorClave.mockReset();
  getPedidoPorClave.mockResolvedValue(null);
  disponibilidadParaMostrar.mockReset();
  disponibilidadParaMostrar.mockResolvedValue(null);
  marcarModalidadesCambiadas.mockReset();
  crearPedido.mockReset();
  crearPedido.mockImplementation(async (_c, datos) => ({
    id: "p1",
    numero: "PED-00000001",
    repetido: false,
    cuotas: datos.cuotas ?? null,
    formaCobro: datos.formaCobro ?? null,
    cuentaPago: null,
  }));
});

describe("POST /api/pedidos — venta sin stock por modalidad", () => {
  it("mixto en_linea + a_confirmar + con stock: pedido a_coordinar con la lista del destacado en todas las líneas", async () => {
    const r = await post({ items: [enLinea, aConfirmar, conStock], pagoMetodo: "a_coordinar" });
    expect(r.status).toBe(201);
    expect(crearPedido).toHaveBeenCalledWith(
      expect.objectContaining({ idPriceList: "lista-destacado" }),
      expect.objectContaining({ pagoMetodo: "a_coordinar", cuotas: null, formaCobro: null }),
      expect.anything(),
    );
    const cotizacion = crearPedido.mock.calls[0][2];
    expect(cotizacion).toMatchObject({ flujo: "a_confirmar", total: 300 });
    expect(cotizacion.lineas.every((l: { precioUnitario: number }) => l.precioUnitario === 100)).toBe(true);
    // La respuesta trae la cotización con el flujo: el checkout lee `respuesta.cotizacion.flujo`.
    expect((await r.json()).cotizacion).toMatchObject({ flujo: "a_confirmar" });
  });

  it("a_confirmar con un medio en línea en el body → 409 pedido_a_confirmar con la cotización", async () => {
    for (const pagoMetodo of ["mercadopago", "transferencia"]) {
      const r = await post({ items: [aConfirmar, conStock], pagoMetodo });
      expect(r.status, pagoMetodo).toBe(409);
      const j = await r.json();
      expect(j).toMatchObject({ error: A_CONFIRMAR, motivo: "pedido_a_confirmar" });
      expect(j.cotizacion).toMatchObject({ flujo: "a_confirmar" });
    }
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("a_confirmar con un medio en línea: si la clave ya creó el pedido (reintento), devuelve ése", async () => {
    getPedidoPorClave.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "p0", numero: "PED-00000009" });
    const r = await post({
      items: [aConfirmar],
      pagoMetodo: "mercadopago",
      idempotencyKey: "0b1b0b1b-0b1b-4b1b-8b1b-0b1b0b1b0b1b",
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ id: "p0", repetido: true });
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("sólo en_linea: checkout normal; a_coordinar con medios aplicables → 400 como hoy", async () => {
    const r = await post({ items: [enLinea, conStock], pagoMetodo: "mercadopago" });
    expect(r.status).toBe(201);
    expect(crearPedido.mock.calls[0][0]).toMatchObject({ idPriceList: "lista-mp" });
    expect(crearPedido.mock.calls[0][1]).toMatchObject({ pagoMetodo: "mercadopago" });
    expect(crearPedido.mock.calls[0][2]).toMatchObject({ flujo: "normal" });

    const r2 = await post({ items: [enLinea, conStock], pagoMetodo: "a_coordinar" });
    expect(r2.status).toBe(400);
    expect(await r2.json()).toEqual({ error: NO_DISPONIBLE });
    expect(crearPedido).toHaveBeenCalledTimes(1);
    expect(listasCotizadas()).not.toContain("lista-destacado");
  });

  describe("el checkout lo armó a confirmar y dejó de serlo con el checkout abierto", () => {
    const YA_NO = "Su pedido ya no se confirma por contacto: elija un medio de pago.";

    it("entró stock (la línea ya no va a pedido): 409 pedido_ya_no_a_confirmar con la cotización", async () => {
      // Con stock la línea conserva `aceptaSinStock` pero no va a pedido: flujo normal.
      cotizar.mockImplementation(async (lineas, o) => {
        const c = await cotizacionFalsa(lineas, o);
        const sinPedido = c.lineas.map((l) => ({ ...l, ventaSinStock: undefined, stockDisponible: 5 }));
        return { ...c, lineas: sinPedido, flujo: "normal" };
      });
      const r = await post({ items: [aConfirmar, conStock], pagoMetodo: "a_coordinar", flujoVisto: "a_confirmar" });
      expect(r.status).toBe(409);
      const j = await r.json();
      expect(j).toMatchObject({ error: YA_NO, motivo: "pedido_ya_no_a_confirmar" });
      expect(j.cotizacion).toMatchObject({ flujo: "normal" });
      expect(crearPedido).not.toHaveBeenCalled();
    });

    it("la modalidad pasó a en línea: también 409; sin flujoVisto sigue el 400 de siempre", async () => {
      modalidadDe = { [aConfirmar.id]: EN_LINEA };
      const r = await post({ items: [aConfirmar], pagoMetodo: "a_coordinar", flujoVisto: "a_confirmar" });
      expect(r.status).toBe(409);
      expect(await r.json()).toMatchObject({ motivo: "pedido_ya_no_a_confirmar" });
      // Un cliente que no pasó por el flujo a confirmar (no manda `flujoVisto`): el 400 de hoy.
      const r2 = await post({ items: [aConfirmar], pagoMetodo: "a_coordinar" });
      expect(r2.status).toBe(400);
      expect(await r2.json()).toEqual({ error: NO_DISPONIBLE });
      // `flujoVisto` con otro valor tampoco cambia nada.
      const r3 = await post({ items: [aConfirmar], pagoMetodo: "a_coordinar", flujoVisto: "normal" });
      expect(r3.status).toBe(400);
      expect(crearPedido).not.toHaveBeenCalled();
    });

    it("si la clave ya creó el pedido (reintento), devuelve ése", async () => {
      modalidadDe = { [aConfirmar.id]: EN_LINEA };
      getPedidoPorClave.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "p0", numero: "PED-00000009" });
      const r = await post({
        items: [aConfirmar],
        pagoMetodo: "a_coordinar",
        flujoVisto: "a_confirmar",
        idempotencyKey: "0b1b0b1b-0b1b-4b1b-8b1b-0b1b0b1b0b1b",
      });
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ id: "p0", repetido: true });
    });

    it("sigue a confirmar: flujoVisto no cambia nada y el pedido se crea", async () => {
      const r = await post({ items: [aConfirmar], pagoMetodo: "a_coordinar", flujoVisto: "a_confirmar" });
      expect(r.status).toBe(201);
    });

    it("cuenta corriente: flujoVisto no aplica (su a_coordinar inválido es el 400 de siempre)", async () => {
      identidad = {
        clerkUserId: "user_1",
        email: "cc@cliente.example",
        cliente: { codigocliente: "C-1", razonsocial: "Cliente Ejemplo SA", tipoCuenta: "corriente", origen: "vinculacion" },
      };
      medios = [medio({}), MERCADOPAGO, CC];
      modalidadDe = { [aConfirmar.id]: EN_LINEA };
      const r = await post({ items: [aConfirmar], pagoMetodo: "a_coordinar", flujoVisto: "a_confirmar" });
      expect(r.status).toBe(400);
    });
  });

  it("sin modalidades: a_coordinar con medios aplicables → el mismo 400 de hoy", async () => {
    modalidadDe = {};
    const r = await post({ items: [conStock], pagoMetodo: "a_coordinar" });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: NO_DISPONIBLE });
    expect(crearPedido).not.toHaveBeenCalled();
  });

  it("sin medios aplicables, a_coordinar con una línea a confirmar: válido y con la lista del destacado si la hay", async () => {
    medios = [];
    const r = await post({ items: [aConfirmar], pagoMetodo: "a_coordinar" });
    expect(r.status).toBe(201);
    // Sin medios no hay destacado: la lista general (como hoy).
    expect(crearPedido.mock.calls[0][0].idPriceList).toBeUndefined();
  });

  it("cuenta corriente con una línea a confirmar: sigue con su medio", async () => {
    identidad = {
      clerkUserId: "user_1",
      email: "cc@cliente.example",
      cliente: { codigocliente: "C-1", razonsocial: "Cliente Ejemplo SA", tipoCuenta: "corriente", origen: "vinculacion" },
    };
    medios = [medio({}), MERCADOPAGO, CC];
    const r = await post({ items: [aConfirmar, conStock], pagoMetodo: "efectivo-cheque" });
    expect(r.status).toBe(201);
    expect(crearPedido.mock.calls[0][1]).toMatchObject({ pagoMetodo: "efectivo-cheque" });
    expect(crearPedido.mock.calls[0][2]).toMatchObject({ flujo: "a_confirmar" });
    expect(listasCotizadas()).not.toContain("lista-destacado");
    // Y no puede pasarse a a_coordinar por el flujo: el 400 de hoy.
    const r2 = await post({ items: [aConfirmar], pagoMetodo: "a_coordinar" });
    expect(r2.status).toBe(400);
    expect(crearPedido).toHaveBeenCalledTimes(1);
  });

  it("modalidad desactivada entre cotización y transacción → 409 con la recotización", async () => {
    crearPedido.mockImplementationOnce(async () => {
      // Se desactivó: la recotización ya no la ve y la línea queda sin stock.
      modalidadDe = {};
      throw new VentaSinStockCambioError([aConfirmar.id]);
    });
    cotizar.mockImplementation(async (lineas, o) => {
      const c = await cotizacionFalsa(lineas, o);
      if (modalidadDe[aConfirmar.id]) return c;
      return {
        ...c,
        hayProblemas: true,
        lineas: c.lineas.map((l) =>
          l.id === aConfirmar.id ? { ...l, problema: "sin_stock", detalle: "Sin stock por el momento." } : l,
        ),
      };
    });
    const r = await post({ items: [aConfirmar, conStock], pagoMetodo: "a_coordinar" });
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.error).toBe("Algunos productos cambiaron. Revise el detalle antes de confirmar.");
    expect(j.cotizacion.lineas.find((l: { id: string }) => l.id === aConfirmar.id)).toMatchObject({
      problema: "sin_stock",
    });
    // La recotización usa las mismas opciones (la lista del pedido a confirmar).
    expect(listasCotizadas().at(-1)).toBe("lista-destacado");
    // La lista cacheada de modalidades quedó vieja: se vence para el reintento.
    expect(marcarModalidadesCambiadas).toHaveBeenCalledTimes(1);
  });

  describe("con el flag disponibilidad-sucursal", () => {
    beforeEach(() => {
      setFlag("sucursales", true);
      estadoDisp = true;
      // Las modalidades activas (caché `catalogo`); el mock global devuelve [].
      vi.mocked(modalidadesActivas).mockResolvedValue([EN_LINEA, A_PEDIDO]);
    });

    it("sin modalidades activas no consulta el motor: decide el stock de la cotización, sin aPedido", async () => {
      vi.mocked(modalidadesActivas).mockResolvedValue([]);
      modalidadDe = {};
      disponibilidadParaMostrar.mockResolvedValue({ productos: productos("por_pedido"), locales: [] });
      const r = await post({ items: [conStock], pagoMetodo: "transferencia", sucursalRetiro: "sede-a" });
      expect(r.status).toBe(201);
      expect(disponibilidadParaMostrar).not.toHaveBeenCalled();
      expect(cotizar.mock.calls[0][1]).not.toHaveProperty("aPedido");
    });

    const productos = (estado: string) => ({
      [aConfirmar.id]: { envio: { estado }, retiro: { "sede-a": { estado }, "sede-b": { estado: "disponible" } } },
      [conStock.id]: { envio: { estado: "disponible" }, retiro: { "sede-a": { estado: "disponible" } } },
    });

    it("las líneas a pedido las decide el motor para el local elegido (como el carrito)", async () => {
      disponibilidadParaMostrar.mockResolvedValue({ productos: productos("por_pedido"), locales: [] });
      const r = await post({ items: [aConfirmar, conStock], pagoMetodo: "a_coordinar", sucursalRetiro: "sede-a" });
      expect(r.status).toBe(201);
      expect(disponibilidadParaMostrar.mock.calls[0][0]).toEqual([aConfirmar.id, conStock.id]);
      expect(disponibilidadParaMostrar.mock.calls[0][1]).toEqual(disp);
      expect(disponibilidadParaMostrar.mock.calls[0][2]).toEqual({ [aConfirmar.id]: 1, [conStock.id]: 1 });
      const opciones = cotizar.mock.calls[0][1] as { aPedido?: ReadonlySet<string> };
      expect([...(opciones.aPedido ?? [])]).toEqual([aConfirmar.id]);
      expect(crearPedido.mock.calls[0][0]).toMatchObject({ idPriceList: "lista-destacado" });
    });

    it("en el local elegido otra sucursal lo cubre: no va a pedido y el pedido es normal", async () => {
      disponibilidadParaMostrar.mockResolvedValue({ productos: productos("por_pedido"), locales: [] });
      const r = await post({ items: [aConfirmar, conStock], pagoMetodo: "transferencia", sucursalRetiro: "sede-b" });
      expect(r.status).toBe(201);
      expect([...((cotizar.mock.calls[0][1] as { aPedido?: Set<string> }).aPedido ?? [])]).toEqual([]);
      expect(crearPedido.mock.calls[0][2]).toMatchObject({ flujo: "normal" });
    });

    it("retiro sin local elegido: el local de retiro por defecto (sucursal de la zona)", async () => {
      disponibilidadParaMostrar.mockResolvedValue({ productos: productos("por_pedido"), locales: [] });
      await post({ items: [aConfirmar], pagoMetodo: "a_coordinar", entregaProvincia: "Misiones" });
      expect([...((cotizar.mock.calls[0][1] as { aPedido?: Set<string> }).aPedido ?? [])]).toEqual([aConfirmar.id]);
    });

    it("sin disponibilidad (null o falla): decide el stock de la cotización, sin aPedido", async () => {
      disponibilidadParaMostrar.mockRejectedValue(new Error("caída"));
      const r = await post({ items: [conStock], pagoMetodo: "transferencia", sucursalRetiro: "sede-a" });
      expect(r.status).toBe(201);
      expect(cotizar.mock.calls[0][1]).not.toHaveProperty("aPedido");
    });
  });
});
