import { describe, expect, it, vi } from "vitest";
import { REGISTRO, infracciones } from "@/test/registro-usted";
import type { OpcionesEmail } from "../email";
import { armarMailComprobante, enviarAvisoComprobante, type RepoMail } from "./mail";
import type { ComprobanteFila } from "./repo";

/**
 * Aviso por mail del comprobante de un comprador SIN cuenta corriente (codigocliente NULL desde
 * la 0056 del CRM, rebanada C): dice "Sin cuenta corriente · Pedido PED-…" en lugar del código y
 * el número del pedido sale de la fila (`shop_order_id`). Datos ficticios, dominios .example.
 */

const ID = "11111111-2222-4333-8444-555555555555";
const PEDIDO = "99999999-2222-4333-8444-555555555555";
const NOW = new Date("2026-09-12T13:00:00.000Z");
const TENANT = { id: "tenant-a", nombre: "Tienda Demo", mailComprobantes: "pagos@tienda.cliente.example" };
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);

function fila(overrides: Partial<ComprobanteFila> = {}): ComprobanteFila {
  return {
    id: ID,
    tenantId: TENANT.id,
    codigocliente: null,
    shopOrderId: PEDIDO,
    clerkUserId: "user_1",
    razonsocial: "Compras Demo SRL",
    cuit: "30123456780",
    clientEmail: "carla@cliente.example",
    amount: "150000.50",
    currency: "ARS",
    paidOn: "2026-09-10",
    method: "transferencia",
    methodOther: null,
    notes: null,
    status: "pending",
    processingStartedAt: null,
    rejectReason: null,
    declaredContentType: "application/pdf",
    declaredSize: PDF.length,
    fileKey: `receipts/${TENANT.id}/2026-09/${ID}.pdf`,
    fileMime: "application/pdf",
    fileSize: PDF.length,
    fileOriginalName: null,
    fileSha256: "abc",
    convertedFrom: null,
    emailStatus: "pending",
    emailError: null,
    emailSentAt: null,
    emailAttempts: 1,
    emailLastAttemptAt: NOW,
    loadedAt: null,
    alegraPaymentNumber: null,
    createdAt: NOW,
    submittedAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function datos(receipt: Partial<Parameters<typeof armarMailComprobante>[0]["receipt"]> = {}) {
  const r = fila();
  return {
    tenantName: TENANT.nombre,
    receipt: {
      ...r,
      fileMime: r.fileMime as string,
      fileSize: r.fileSize as number,
      submittedAt: NOW,
      ...receipt,
    },
    adminUrl: "https://crm.plataforma.example/admin/comprobantes?id=" + ID,
    attachmentIncluded: true,
    clientEmail: r.clientEmail,
  };
}

describe("armarMailComprobante sin cuenta corriente", () => {
  it("'Sin cuenta corriente · Pedido PED-…' en lugar del código, en html y texto, en usted", () => {
    const m = armarMailComprobante(datos({ pedidoNumero: "PED-00000042" }));
    expect(m.html).toContain("Sin cuenta corriente · Pedido PED-00000042");
    expect(m.text).toContain("Cuenta: Sin cuenta corriente · Pedido PED-00000042");
    expect(m.html).not.toContain(">Código<");
    expect(m.text).not.toContain("Código:");
    expect(m.text).not.toContain("null");
    expect(infracciones(m.text, REGISTRO)).toEqual([]);
  });

  it("sin número de pedido igual dice 'Sin cuenta corriente'; el número se escapa", () => {
    expect(armarMailComprobante(datos()).text).toContain("Cuenta: Sin cuenta corriente");
    expect(armarMailComprobante(datos({ pedidoNumero: "<b>x</b>" })).html).not.toContain("<b>x</b>");
  });

  it("con cuenta corriente y pedido: conserva el código y suma el pedido; sin pedido, igual que antes", () => {
    const conPedido = armarMailComprobante(datos({ codigocliente: "12345", pedidoNumero: "PED-00000007" }));
    expect(conPedido.text).toContain("Código: 12345");
    expect(conPedido.text).toContain("Pedido: PED-00000007");
    const clasico = armarMailComprobante(datos({ codigocliente: "12345" }));
    expect(clasico.text).toContain("Código: 12345");
    expect(clasico.text).not.toContain("Pedido");
  });
});

function repoFake(row: ComprobanteFila) {
  return {
    tomarIntentoMail: vi.fn<RepoMail["tomarIntentoMail"]>(async () => 1),
    buscarPublicado: vi.fn<RepoMail["buscarPublicado"]>(async () => row),
    registrarMail: vi.fn<RepoMail["registrarMail"]>(async () => {}),
  };
}

const ENV = { CRM_ADMIN_URL: "https://crm.plataforma.example", RECEIPTS_EMAIL_FROM: "comprobantes@plataforma.example" };

describe("enviarAvisoComprobante sin cuenta corriente", () => {
  it("resuelve el número del pedido de la fila y lo pone en el mail", async () => {
    const repo = repoFake(fila());
    const enviar = vi.fn(async (opts: OpcionesEmail) => (void opts, { ok: true as const, id: "m1" }));
    const numeroPedido = vi.fn(async () => "PED-00000042");
    const r = await enviarAvisoComprobante(
      { tenant: TENANT, id: ID, buffer: PDF },
      { repo, env: ENV, enviar, now: () => NOW, numeroPedido },
    );
    expect(r).toEqual({ status: "sent" });
    expect(numeroPedido).toHaveBeenCalledWith(TENANT.id, PEDIDO);
    const opts = enviar.mock.calls[0]?.[0] as OpcionesEmail;
    expect(opts.text).toContain("Sin cuenta corriente · Pedido PED-00000042");
  });

  it("si no se puede resolver el número, el mail sale igual sin él", async () => {
    const repo = repoFake(fila());
    const enviar = vi.fn(async (opts: OpcionesEmail) => (void opts, { ok: true as const, id: "m1" }));
    const numeroPedido = vi.fn(async () => {
      throw new Error("base caída");
    });
    const r = await enviarAvisoComprobante(
      { tenant: TENANT, id: ID, buffer: PDF },
      { repo, env: ENV, enviar, now: () => NOW, numeroPedido },
    );
    expect(r).toEqual({ status: "sent" });
    expect((enviar.mock.calls[0]?.[0] as OpcionesEmail).text).toContain("Cuenta: Sin cuenta corriente");
  });

  it("un comprobante sin pedido no consulta el número", async () => {
    const repo = repoFake(fila({ codigocliente: "12345", shopOrderId: null, clerkUserId: null }));
    const enviar = vi.fn(async (opts: OpcionesEmail) => (void opts, { ok: true as const, id: "m1" }));
    const numeroPedido = vi.fn(async () => "PED-1");
    await enviarAvisoComprobante(
      { tenant: TENANT, id: ID, buffer: PDF },
      { repo, env: ENV, enviar, now: () => NOW, numeroPedido },
    );
    expect(numeroPedido).not.toHaveBeenCalled();
  });
});
