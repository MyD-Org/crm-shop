import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Página /checkout: gate de la compra como invitado (change `compra-como-invitado`, S2b).
 * Se llama a la página como función y se mira qué le pasa a `CheckoutClient`.
 */

const REDIRECT = new Error("NEXT_REDIRECT");
const redirect = vi.fn((destino: string) => {
  void destino;
  throw REDIRECT;
});
vi.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));

const identidadActual = vi.fn();
vi.mock("@/lib/auth", () => ({ identidadActual: () => identidadActual() }));

const flag = vi.fn();
vi.mock("@/lib/compra-invitado-flag", () => ({ compraInvitadoHabilitada: () => flag() }));

const datosDelContacto = vi.fn();
const listarDirecciones = vi.fn();
vi.mock("@/lib/datos-del-contacto", async (orig) => ({
  ...(await orig<typeof import("@/lib/datos-del-contacto")>()),
  datosDelContacto: (a: unknown) => datosDelContacto(a),
}));
vi.mock("@/lib/direcciones-envio-db", () => ({ listarDirecciones: (a: unknown) => listarDirecciones(a) }));

vi.mock("@/components/CheckoutClient", () => ({ CheckoutClient: () => null }));
vi.mock("@/lib/contacto-alegra", () => ({ telefonoDelCheckout: () => ({ inicial: "" }) }));
vi.mock("@/lib/sucursales-datos", () => ({ reglasVentaCacheadas: async () => ({ envio: null }) }));
vi.mock("@/lib/zona-servidor", () => ({ opcionesCheckoutDelVisitante: async () => null }));
vi.mock("@/lib/ubicacion-servidor", () => ({
  ubicacionDelVisitante: async () => ({ eleccion: { tipo: "ninguna" } }),
}));
vi.mock("@/lib/medios-pago-datos", () => ({ mediosOfreciblesComprador: async () => [] }));
vi.mock("@/lib/pagos/tarjetas-aceptadas-mp", () => ({ getTarjetasMercadoPago: async () => undefined }));
vi.mock("@/lib/pagos/mercadopago-preferencia", () => ({ idPagoDeRetorno: () => null }));

// El secreto sólo existe en este test; no es una credencial.
process.env.PEDIDO_LINK_SECRET = "x".repeat(40);
process.env.SHOP_TENANT_ID = "tenant-test";
import { acuñarTokenCompra } from "@/lib/pedido-token";
import CheckoutPage from "./page";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

const sinSesion = { clerkUserId: null, cliente: null, nombre: null, email: null };
const conSesion = { clerkUserId: "user_1", cliente: null, nombre: "Ana", email: "ana@cliente.example" };

type Props = {
  invitado?: { activo: boolean; tokenRetorno?: string; sinToken?: boolean; turnstileSiteKey: string } | null;
  facturacion: unknown;
  emailCliente?: string;
};
async function props(sp: Record<string, string | undefined> = {}): Promise<Props> {
  const el = (await CheckoutPage({ searchParams: Promise.resolve(sp) })) as {
    props: { children: Array<{ props?: Props } | null> };
  };
  const hijo = el.props.children.find((c) => c && c.props && "facturacion" in c.props);
  return hijo!.props!;
}

beforeEach(() => {
  vi.clearAllMocks();
  datosDelContacto.mockResolvedValue({
    fuente: "perfil",
    vinculado: false,
    alegraId: null,
    datos: { pais: "AR" },
    bloqueados: [],
    faltantes: [],
    completo: false,
    motivoRevision: null,
    tipoDocDeducido: false,
    telefonos: null,
    telefonoAlegra: null,
    perfil: null,
    interno: null,
  });
  listarDirecciones.mockResolvedValue([]);
});

describe("/checkout: anónimo", () => {
  it("flag apagado: redirige a /ingresar, como siempre", async () => {
    identidadActual.mockResolvedValue(sinSesion);
    flag.mockResolvedValue(false);
    await expect(props()).rejects.toBe(REDIRECT);
    expect(redirect.mock.calls[0][0]).toMatch(/^\/ingresar/);
    expect(datosDelContacto).not.toHaveBeenCalled();
  });

  it("flag encendido: modo invitado, sin consultar contacto ni direcciones", async () => {
    identidadActual.mockResolvedValue(sinSesion);
    flag.mockResolvedValue(true);
    const p = await props();
    expect(p.invitado).toMatchObject({ activo: true });
    expect(datosDelContacto).not.toHaveBeenCalled();
    expect(listarDirecciones).not.toHaveBeenCalled();
    expect(p.facturacion).toMatchObject({ vinculado: false, fuente: "ninguna" });
  });

  it("retorno con token válido de ese pedido: lo pasa por prop", async () => {
    identidadActual.mockResolvedValue(sinSesion);
    flag.mockResolvedValue(true);
    const { token } = acuñarTokenCompra(ID_A);
    const p = await props({ pedido: ID_A, pago: "mp", t: token });
    expect(p.invitado?.tokenRetorno).toBe(token);
    expect(p.invitado?.sinToken).toBeUndefined();
  });

  it("retorno con el token de OTRO pedido, sin token o alterado: sinToken y nada del pedido", async () => {
    identidadActual.mockResolvedValue(sinSesion);
    flag.mockResolvedValue(true);
    const { token } = acuñarTokenCompra(ID_B);
    for (const t of [token, undefined, token.slice(0, -2) + "xx", "basura"]) {
      const p = await props({ pedido: ID_A, t });
      expect(p.invitado?.sinToken).toBe(true);
      expect(p.invitado?.tokenRetorno).toBeUndefined();
    }
  });

  it("retorno con token vencido: sinToken", async () => {
    identidadActual.mockResolvedValue(sinSesion);
    flag.mockResolvedValue(true);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const { token } = acuñarTokenCompra(ID_A);
      vi.setSystemTime(new Date("2026-01-01T07:00:00Z")); // pasaron más de 6 h
      const p = await props({ pedido: ID_A, t: token });
      expect(p.invitado?.sinToken).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("/checkout: con sesión", () => {
  it("nunca ve el formulario de invitado ni se evalúa el flag", async () => {
    identidadActual.mockResolvedValue(conSesion);
    flag.mockResolvedValue(true);
    const p = await props({ pedido: ID_A, t: "lo-que-sea" });
    expect(p.invitado).toBeNull();
    expect(flag).not.toHaveBeenCalled();
    expect(datosDelContacto).toHaveBeenCalledOnce();
  });
});
