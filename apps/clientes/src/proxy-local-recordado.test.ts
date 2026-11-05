import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Clerk no participa: se reemplaza para no depender de sus claves en el test.
vi.mock("@clerk/nextjs/server", () => ({ clerkMiddleware: () => () => undefined }));

const CON_COOKIE = { cookie: "local_retiro=mdp" };

async function pedir(ruta: string, headers: Record<string, string>) {
  delete process.env.SITE_AUTH_USER;
  delete process.env.SITE_AUTH_PASSWORD;
  const { proxy } = await import("./proxy");
  return proxy(new NextRequest(`https://tienda.example${ruta}`, { headers }), {} as never);
}

describe("proxy: local recordado y precargas del router", () => {
  it("una navegación a /catalogo con la cookie redirige con el local puesto", async () => {
    const r = await pedir("/catalogo?categoria=HOGAR", { ...CON_COOKIE, rsc: "1" });
    expect(r?.status).toBe(307);
    expect(r?.headers.get("location")).toContain("retiro=mdp");
  });

  it("una precarga no redirige: el router la guardaría y volvería a poner el local ya quitado", async () => {
    const r = await pedir("/catalogo?categoria=HOGAR", {
      ...CON_COOKIE,
      rsc: "1",
      "next-router-prefetch": "1",
    });
    expect(r?.status).not.toBe(307);
    expect(r?.headers.get("location")).toBeNull();
  });

  it("una precarga de un link con ?sucursal= no guarda la cookie", async () => {
    const r = await pedir("/?sucursal=mdp", { rsc: "1", "next-router-prefetch": "1" });
    expect(r?.headers.get("set-cookie") ?? "").not.toContain("local_retiro");
  });
});
