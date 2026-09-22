import { afterEach, describe, expect, it, vi } from "vitest";
import { createR2, R2Error, type R2Config } from "./r2";

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
