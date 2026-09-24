import { describe, expect, it, vi } from "vitest";
import type { OpcionesEmail } from "../email";
import { ATTACH_MAX_BYTES, armarMailComprobante, enviarAvisoComprobante, urlBackoffice, type RepoMail } from "./mail";
import type { ComprobanteFila } from "./repo";

/**
 * Aviso por mail de un comprobante (CMP-3). Portado en parte de
 * apps/admin/src/lib/receipt-email.test.ts; lo propio del Shop: el link al
 * backoffice sale de CRM_ADMIN_URL (nunca del request), sin la variable el
 * mail va sin botón, copy en usted y el envío por el `enviarEmail` del Shop.
 * Datos ficticios, dominios .example.
 */

const ID = "11111111-2222-4333-8444-555555555555";
const NOW = new Date("2026-09-12T13:00:00.000Z");
const TENANT = { id: "tenant-a", nombre: "Tienda Demo", mailComprobantes: "pagos@tienda.cliente.example" };
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);

function fila(overrides: Partial<ComprobanteFila> = {}): ComprobanteFila {
  return {
    id: ID,
    tenantId: TENANT.id,
    codigocliente: "12345",
    razonsocial: "Cliente <Demo> SRL",
    cuit: "30123456780",
    clientEmail: "cliente@empresa.cliente.example",
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

function datos(adminUrl: string | null) {
  const r = fila();
  return {
    tenantName: TENANT.nombre,
    receipt: { ...r, fileMime: r.fileMime as string, fileSize: r.fileSize as number, submittedAt: NOW },
    adminUrl,
    attachmentIncluded: true,
    clientEmail: r.clientEmail,
  };
}

describe("urlBackoffice", () => {
  it("CRM_ADMIN_URL ⇒ /admin/comprobantes?id=<id> (sin barra doble)", () => {
    expect(urlBackoffice("r1", { CRM_ADMIN_URL: "https://crm.plataforma.example" })).toBe(
      "https://crm.plataforma.example/admin/comprobantes?id=r1",
    );
    expect(urlBackoffice("r1", { CRM_ADMIN_URL: "https://crm.plataforma.example/" })).toBe(
      "https://crm.plataforma.example/admin/comprobantes?id=r1",
    );
  });

  it("sin variable o con algo que no es http(s) ⇒ null", () => {
    expect(urlBackoffice("r1", {})).toBeNull();
    expect(urlBackoffice("r1", { CRM_ADMIN_URL: "  " })).toBeNull();
    expect(urlBackoffice("r1", { CRM_ADMIN_URL: "javascript:alert(1)" })).toBeNull();
  });
});

describe("armarMailComprobante", () => {
  it("asunto con el prefijo del portal, en una línea; datos escapados", () => {
    const mail = armarMailComprobante(datos("https://crm.plataforma.example/admin/comprobantes?id=r1"));
    expect(mail.subject.startsWith("[Comprobante de pago] Cliente <Demo> SRL — ")).toBe(true);
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.html).toContain("Cliente &lt;Demo&gt; SRL");
    expect(mail.html).not.toContain("<Demo>");
  });

  it("con URL del admin: botón 'Ver en el backoffice' y el link en el texto", () => {
    const url = "https://crm.plataforma.example/admin/comprobantes?id=r1";
    const mail = armarMailComprobante(datos(url));
    expect(mail.html).toContain(`href="${url}"`);
    expect(mail.html).toContain("Ver en el backoffice");
    expect(mail.text).toContain(`Ver en el backoffice: ${url}`);
  });

  it("sin URL del admin: sin botón ni link (nunca el host del Shop)", () => {
    const mail = armarMailComprobante({ ...datos(null), attachmentIncluded: false });
    expect(mail.html).not.toContain("Ver en el backoffice");
    expect(mail.html).not.toContain("href=");
    expect(mail.text).not.toContain("Ver en el backoffice");
    expect(mail.text).toContain("búsquelo en Comprobantes del backoffice");
  });

  it("copy en usted y pie de la tienda (no el del portal)", () => {
    const mail = armarMailComprobante({ ...datos("https://crm.plataforma.example/x"), attachmentIncluded: false });
    for (const texto of [mail.html, mail.text]) {
      expect(texto).toContain("Enviado automáticamente desde Mi cuenta de la tienda de Tienda Demo.");
      expect(texto).toContain("Responda este mail para escribirle al cliente.");
      expect(texto).not.toMatch(/\b(?:abrilo|respondé|portal de clientes)\b/i);
    }
  });
});

function repoFake(opts: { attempt?: number | null; row?: ComprobanteFila | null } = {}) {
  return {
    tomarIntentoMail: vi.fn<RepoMail["tomarIntentoMail"]>(async () => (opts.attempt === undefined ? 1 : opts.attempt)),
    buscarPublicado: vi.fn<RepoMail["buscarPublicado"]>(async () => (opts.row === undefined ? fila() : opts.row)),
    registrarMail: vi.fn<RepoMail["registrarMail"]>(async () => {}),
  };
}

const ENV = { CRM_ADMIN_URL: "https://crm.plataforma.example", RECEIPTS_EMAIL_FROM: "comprobantes@plataforma.example" };

function enviarFake(resultado: Awaited<ReturnType<typeof import("../email").enviarEmail>> = { ok: true, id: "m1" }) {
  return vi.fn(async (opts: OpcionesEmail) => {
    void opts;
    return resultado;
  });
}

describe("enviarAvisoComprobante", () => {
  it("CMP-3 link correcto: el mail enlaza a CRM_ADMIN_URL/admin/comprobantes?id=<id>", async () => {
    const repo = repoFake();
    const enviar = enviarFake();
    const r = await enviarAvisoComprobante(
      { tenant: TENANT, id: ID, buffer: PDF },
      { repo, env: ENV, enviar, now: () => NOW },
    );
    expect(r).toEqual({ status: "sent" });
    const opts = enviar.mock.calls[0]?.[0] as OpcionesEmail;
    expect(opts.to).toBe(TENANT.mailComprobantes);
    expect(opts.html).toContain(`https://crm.plataforma.example/admin/comprobantes?id=${ID}`);
    expect(opts.from).toBe('"Tienda Demo · Comprobantes" <comprobantes@plataforma.example>');
    expect(opts.replyTo).toBe("cliente@empresa.cliente.example");
    expect(opts.idempotencyKey).toBe(`payment-receipt/${ID}/1`);
    expect(opts.attachments?.[0]).toMatchObject({
      filename: `comprobante-2026-09-10-11111111.pdf`,
      contentType: "application/pdf",
    });
    expect(repo.registrarMail).toHaveBeenCalledWith(TENANT.id, ID, { status: "sent" }, NOW);
  });

  it("sin CRM_ADMIN_URL: sale igual, sin botón", async () => {
    const enviar = enviarFake();
    await enviarAvisoComprobante(
      { tenant: TENANT, id: ID, buffer: PDF },
      { repo: repoFake(), env: { RECEIPTS_EMAIL_FROM: ENV.RECEIPTS_EMAIL_FROM }, enviar, now: () => NOW },
    );
    const opts = enviar.mock.calls[0]?.[0] as OpcionesEmail;
    expect(opts.html).not.toContain("Ver en el backoffice");
  });

  it("sin receipts_email ⇒ skipped, sin enviar", async () => {
    const repo = repoFake();
    const enviar = enviarFake();
    const r = await enviarAvisoComprobante(
      { tenant: { ...TENANT, mailComprobantes: null }, id: ID, buffer: PDF },
      { repo, env: ENV, enviar, now: () => NOW },
    );
    expect(r).toEqual({ status: "skipped", reason: "mail destino no configurado" });
    expect(enviar).not.toHaveBeenCalled();
    expect(repo.registrarMail).toHaveBeenCalledWith(TENANT.id, ID, r, NOW);
  });

  it("remitente: RECEIPTS_EMAIL_FROM o EMAIL_FROM tal cual; sin ninguno ⇒ skipped", async () => {
    const enviar = enviarFake();
    await enviarAvisoComprobante(
      { tenant: TENANT, id: ID, buffer: PDF },
      { repo: repoFake(), env: { EMAIL_FROM: "Tienda <hola@tienda.cliente.example>" }, enviar, now: () => NOW },
    );
    expect((enviar.mock.calls[0]?.[0] as OpcionesEmail).from).toBe("Tienda <hola@tienda.cliente.example>");

    const sinRemitente = await enviarAvisoComprobante(
      { tenant: TENANT, id: ID, buffer: PDF },
      { repo: repoFake(), env: {}, enviar: enviarFake(), now: () => NOW },
    );
    expect(sinRemitente).toEqual({ status: "skipped", reason: "remitente no configurado" });
  });

  it("lease ocupado ⇒ in_progress, sin tocar nada", async () => {
    const repo = repoFake({ attempt: null });
    const enviar = enviarFake();
    expect(
      await enviarAvisoComprobante({ tenant: TENANT, id: ID, buffer: PDF }, { repo, env: ENV, enviar, now: () => NOW }),
    ).toEqual({ status: "in_progress" });
    expect(enviar).not.toHaveBeenCalled();
    expect(repo.registrarMail).not.toHaveBeenCalled();
  });

  it("sin RESEND_API_KEY ⇒ skipped; Resend falla ⇒ failed (el comprobante sigue pending)", async () => {
    const sinClave = await enviarAvisoComprobante(
      { tenant: TENANT, id: ID, buffer: PDF },
      {
        repo: repoFake(),
        env: ENV,
        enviar: enviarFake({ ok: false, error: "Email no configurado", noConfigurado: true }),
        now: () => NOW,
      },
    );
    expect(sinClave).toEqual({ status: "skipped", reason: "servicio de correo no configurado" });

    const repo = repoFake();
    const falla = await enviarAvisoComprobante(
      { tenant: TENANT, id: ID, buffer: PDF },
      { repo, env: ENV, enviar: enviarFake({ ok: false, error: "No se pudo enviar el email" }), now: () => NOW },
    );
    expect(falla).toEqual({ status: "failed", error: "No se pudo enviar el email" });
    expect(repo.registrarMail).toHaveBeenCalledWith(TENANT.id, ID, falla, NOW);
  });

  it("archivo de más de 10 MB ⇒ sin adjunto", async () => {
    const enviar = enviarFake();
    const grande = new Uint8Array(ATTACH_MAX_BYTES + 1);
    await enviarAvisoComprobante(
      { tenant: TENANT, id: ID, buffer: grande },
      { repo: repoFake({ row: fila({ fileSize: grande.length }) }), env: ENV, enviar, now: () => NOW },
    );
    expect((enviar.mock.calls[0]?.[0] as OpcionesEmail).attachments).toBeUndefined();
  });
});
