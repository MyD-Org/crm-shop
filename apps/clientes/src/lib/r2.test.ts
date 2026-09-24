import { afterEach, describe, expect, it, vi } from "vitest";
import { comprobantesR2Config, createR2, R2Error, R2TooLargeError, type R2Config } from "./r2";

const CFG: R2Config = {
  accountId: "acc",
  accessKeyId: "AKIA-TEST",
  secretAccessKey: "secreto-test",
  bucket: "shop-media",
  region: "auto",
};

const NOW = new Date("2026-09-22T00:00:00Z");

type FetchMock = ReturnType<typeof vi.fn<(input: Request) => Promise<Response>>>;

function makeR2(fetchImpl: FetchMock) {
  return createR2(CFG, { fetch: fetchImpl as unknown as typeof fetch, now: () => NOW });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("presignPut", () => {
  it("firma tipo y tamaño (allHeaders) y devuelve headers de content-type", async () => {
    const r2 = makeR2(vi.fn<(input: Request) => Promise<Response>>());
    const { url, headers } = await r2.presignPut("home/t/a-1600.webp", {
      contentType: "image/webp",
      contentLength: 1234,
      ttlSeconds: 600,
    });

    expect(url.startsWith("https://acc.r2.cloudflarestorage.com/shop-media/home/t/a-1600.webp?")).toBe(true);
    const u = new URL(url);
    expect(u.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(u.searchParams.get("X-Amz-SignedHeaders")).toContain("content-length");
    expect(u.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect(headers).toEqual({ "content-type": "image/webp" });
  });
});

describe("head", () => {
  it("404 ⇒ null", async () => {
    const r2 = makeR2(vi.fn<(input: Request) => Promise<Response>>(async () => new Response(null, { status: 404 })));
    expect(await r2.head("home/t/a-1600.webp")).toBeNull();
  });

  it("otro error ⇒ R2Error", async () => {
    const r2 = makeR2(vi.fn<(input: Request) => Promise<Response>>(async () => new Response("boom", { status: 500 })));
    await expect(r2.head("home/t/a-1600.webp")).rejects.toBeInstanceOf(R2Error);
  });
});

describe("delete", () => {
  it("204 y 404 ⇒ ok", async () => {
    const r2ok = makeR2(vi.fn<(input: Request) => Promise<Response>>(async () => new Response(null, { status: 204 })));
    await expect(r2ok.delete("home/t/a-1600.webp")).resolves.toBeUndefined();
    const r2404 = makeR2(vi.fn<(input: Request) => Promise<Response>>(async () => new Response(null, { status: 404 })));
    await expect(r2404.delete("home/t/a-1600.webp")).resolves.toBeUndefined();
  });

  it("otro error ⇒ R2Error", async () => {
    const r2 = makeR2(vi.fn<(input: Request) => Promise<Response>>(async () => new Response("boom", { status: 500 })));
    await expect(r2.delete("home/t/a-1600.webp")).rejects.toBeInstanceOf(R2Error);
  });
});

// Portado de apps/admin/src/lib/r2.test.ts: lo que usa el confirm de comprobantes.
describe("getRange / getObject / put", () => {
  it("getRange manda el header range y 404 ⇒ null", async () => {
    const f = vi.fn<(input: Request) => Promise<Response>>(
      async () => new Response(new Uint8Array([1, 2, 3]), { status: 206 }),
    );
    const r2 = makeR2(f);
    expect(await r2.getRange("tmp/receipts/t/x", 0, 1023)).toEqual(new Uint8Array([1, 2, 3]));
    expect(f.mock.calls[0]?.[0].headers.get("range")).toBe("bytes=0-1023");
    const r404 = makeR2(vi.fn<(input: Request) => Promise<Response>>(async () => new Response(null, { status: 404 })));
    expect(await r404.getRange("x", 0, 10)).toBeNull();
  });

  it("getObject corta al pasar maxBytes (R2TooLargeError) y lee entero si entra", async () => {
    const r2 = makeR2(vi.fn<(input: Request) => Promise<Response>>(async () => new Response(new Uint8Array(20))));
    await expect(r2.getObject("x", { maxBytes: 10 })).rejects.toBeInstanceOf(R2TooLargeError);
    const ok = makeR2(vi.fn<(input: Request) => Promise<Response>>(async () => new Response(new Uint8Array(5))));
    expect((await ok.getObject("x", { maxBytes: 10 }))?.length).toBe(5);
  });

  it("put declara content-length y disposition; error ⇒ R2Error", async () => {
    const f = vi.fn<(input: Request) => Promise<Response>>(async () => new Response(null, { status: 200 }));
    await makeR2(f).put("receipts/t/2026-09/x.pdf", new Uint8Array(7), {
      contentType: "application/pdf",
      contentDisposition: 'inline; filename="c.pdf"',
    });
    const req = f.mock.calls[0]?.[0] as Request;
    expect(req.method).toBe("PUT");
    expect(req.headers.get("content-length")).toBe("7");
    expect(req.headers.get("content-disposition")).toBe('inline; filename="c.pdf"');
    const mal = makeR2(vi.fn<(input: Request) => Promise<Response>>(async () => new Response(null, { status: 500 })));
    await expect(mal.put("x", new Uint8Array(1), { contentType: "application/pdf" })).rejects.toBeInstanceOf(R2Error);
  });
});

describe("comprobantesR2Config", () => {
  const COMPLETO = {
    R2_RECEIPTS_ACCESS_KEY_ID: "AKIA-TEST",
    R2_RECEIPTS_SECRET_ACCESS_KEY: "secreto-test",
    R2_RECEIPTS_BUCKET: "comprobantes",
    R2_ACCOUNT_ID: "acc",
  };

  it("las 3 variables + cuenta ⇒ config; la cuenta propia del bucket gana", () => {
    expect(comprobantesR2Config(COMPLETO)).toEqual({
      accountId: "acc",
      accessKeyId: "AKIA-TEST",
      secretAccessKey: "secreto-test",
      bucket: "comprobantes",
      region: "auto",
    });
    expect(comprobantesR2Config({ ...COMPLETO, R2_RECEIPTS_ACCOUNT_ID: "otra" })?.accountId).toBe("otra");
  });

  it("falta cualquiera ⇒ null (informar pago deshabilitado)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const falta of Object.keys(COMPLETO)) {
      const env: Record<string, string | undefined> = { ...COMPLETO, [falta]: undefined };
      expect(comprobantesR2Config(env)).toBeNull();
    }
  });
});
