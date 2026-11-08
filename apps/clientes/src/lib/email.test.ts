import { afterEach, describe, expect, it, vi } from "vitest";
import { enviarEmail } from "./email";
import { getMarca } from "./marca";
import { resolverMarca } from "./marca-base";
import { leerDestinosExtra } from "./sitio-datos";
import { armarMailPedido } from "./pedido-mail";
import { urlLogoMarca } from "./vinculacion-mail";

vi.mock("./sitio-datos", () => ({ leerDestinosExtra: vi.fn(async () => null) }));

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

  it("pasa las cabeceras propias a Resend y, sin ellas, no manda el campo", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const fetchMock = vi.fn(async () => Response.json({ id: "m2" }));
    vi.stubGlobal("fetch", fetchMock);
    const base = { to: "a@cliente.example", subject: "s", html: "h", text: "t" };
    await enviarEmail({
      ...base,
      headers: { "List-Unsubscribe": "<https://tienda.example/baja>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
    await enviarEmail(base);
    const cuerpo = (n: number) =>
      JSON.parse(((fetchMock.mock.calls[n] as unknown as [string, RequestInit])[1]).body as string);
    expect(cuerpo(0).headers).toEqual({
      "List-Unsubscribe": "<https://tienda.example/baja>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(cuerpo(1)).not.toHaveProperty("headers");
  });
});

describe("remitente en un sitio con marca propia", () => {
  const SITIO = "https://tienda-b.example";
  const extras = (remitente?: string) => [
    {
      etiqueta: "tienda-b",
      url: SITIO,
      marca: { nombre: "Tienda B", logoMailUrl: "https://tienda-b.example/logo-mail.png" },
      ...(remitente ? { remitente } : {}),
    },
  ];
  const marcaB = () => resolverMarca(
      { base: "generica", nombre: "Tienda B", logoMailUrl: "https://tienda-b.example/logo-mail.png" },
      undefined,
      ["tienda-b.example"],
    );

  function prepararFetch() {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITIO);
    const fetchMock = vi.fn(async () => Response.json({ id: "m1" }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("mail de pedido: sale del remitente del sitio, con su nombre y su logo", async () => {
    const fetchMock = prepararFetch();
    vi.mocked(leerDestinosExtra).mockResolvedValueOnce(extras("pedidos@tienda-b.example"));
    vi.mocked(getMarca).mockResolvedValue(marcaB());
    const marca = await getMarca();
    const mail = armarMailPedido({
      aviso: "recibido",
      numero: "PED-00000001",
      contactoNombre: "Ana",
      comercio: marca.nombre,
      logoUrl: urlLogoMarca(marca, SITIO),
      pedidosUrl: `${SITIO}/mi-cuenta/pedidos`,
      lineas: [],
      total: 1000,
    } as Parameters<typeof armarMailPedido>[0]);
    const r = await enviarEmail({ to: "a@cliente.example", ...mail });
    expect(r.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const cuerpo = JSON.parse(init.body as string);
    expect(cuerpo.from).toBe("Tienda B <pedidos@tienda-b.example>");
    expect(cuerpo.html).toContain("https://tienda-b.example/logo-mail.png");
    expect(cuerpo.html).toContain("Tienda B");
    expect(cuerpo.html).not.toContain("central-led");
    vi.mocked(getMarca).mockReset();
  });

  it("EMAIL_FROM del proyecto gana sobre el remitente del sitio", async () => {
    const fetchMock = prepararFetch();
    vi.stubEnv("EMAIL_FROM", "Tienda B <hola@tienda-b.example>");
    await enviarEmail({ to: "a@cliente.example", subject: "s", html: "h", text: "t" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).from).toBe("Tienda B <hola@tienda-b.example>");
  });

  it("sin remitente ni EMAIL_FROM: no envía, lo registra y nunca usa el de Central", async () => {
    const fetchMock = prepararFetch();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(leerDestinosExtra).mockResolvedValueOnce(extras());
    const r = await enviarEmail({ to: "a@cliente.example", subject: "s", html: "h", text: "t" });
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("no hay remitente"));
  });

  it("alias del principal (sitio sin marca): el remitente de siempre", async () => {
    const fetchMock = prepararFetch();
    vi.mocked(leerDestinosExtra).mockResolvedValueOnce([{ etiqueta: "alias", url: SITIO }]);
    await enviarEmail({ to: "a@cliente.example", subject: "s", html: "h", text: "t" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).from).toBe("Central LED <onboarding@resend.dev>");
  });
});
