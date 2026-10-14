import { afterEach, describe, expect, it, vi } from "vitest";
import { enviarEmail } from "./email";
import { getMarca } from "./marca";
import { resolverMarca } from "./marca-base";

/** Envío por Resend (HTTP): lo que suma el aviso de comprobantes. */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("remitente por defecto (sin EMAIL_FROM)", () => {
  async function desde(): Promise<string> {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "");
    const fetchMock = vi.fn(async () => Response.json({ id: "m1" }));
    vi.stubGlobal("fetch", fetchMock);
    await enviarEmail({ to: "a@cliente.example", subject: "s", html: "h", text: "t" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    return JSON.parse(init.body as string).from;
  }

  it("Central: el de siempre", async () => {
    expect(await desde()).toBe("Central LED <onboarding@resend.dev>");
  });

  it("otra marca: su nombre, no el de Central", async () => {
    vi.mocked(getMarca).mockResolvedValueOnce(resolverMarca({ base: "generica", nombre: "Tienda Uno" }));
    expect(await desde()).toBe("Tienda Uno <onboarding@resend.dev>");
  });

  it("con EMAIL_FROM manda ese", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Tienda <hola@tienda.example>");
    const fetchMock = vi.fn(async () => Response.json({ id: "m1" }));
    vi.stubGlobal("fetch", fetchMock);
    await enviarEmail({ to: "a@cliente.example", subject: "s", html: "h", text: "t" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).from).toBe("Tienda <hola@tienda.example>");
  });
});

describe("enviarEmail", () => {
  it("sin RESEND_API_KEY ⇒ no envía y marca noConfigurado", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await enviarEmail({ to: "a@cliente.example", subject: "s", html: "h", text: "t" })).toMatchObject({
      ok: false,
      noConfigurado: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("remitente, reply_to, adjunto en base64, tags e Idempotency-Key", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const fetchMock = vi.fn(async () => Response.json({ id: "m1" }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await enviarEmail({
      to: "pagos@tienda.cliente.example",
      subject: "s",
      html: "h",
      text: "t",
      from: '"Tienda · Comprobantes" <comprobantes@plataforma.example>',
      replyTo: "cliente@empresa.cliente.example",
      attachments: [{ filename: "c.pdf", content: new Uint8Array([1, 2, 3]), contentType: "application/pdf" }],
      tags: [{ name: "type", value: "payment_receipt" }],
      idempotencyKey: "payment-receipt/x/1",
    });
    expect(r).toEqual({ ok: true, id: "m1" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("payment-receipt/x/1");
    const enviado = JSON.parse(init.body as string);
    expect(enviado).toMatchObject({
      from: '"Tienda · Comprobantes" <comprobantes@plataforma.example>',
      to: ["pagos@tienda.cliente.example"],
      reply_to: "cliente@empresa.cliente.example",
      attachments: [{ filename: "c.pdf", content: "AQID", content_type: "application/pdf" }],
      tags: [{ name: "type", value: "payment_receipt" }],
    });
  });
});
