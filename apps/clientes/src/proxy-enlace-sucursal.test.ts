import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Clerk no participa: se reemplaza para no depender de sus claves en el test.
vi.mock("@clerk/nextjs/server", () => ({ clerkMiddleware: () => () => undefined }));

async function pedir(ruta: string, headers: Record<string, string> = {}) {
  delete process.env.SITE_AUTH_USER;
  delete process.env.SITE_AUTH_PASSWORD;
  const { proxy } = await import("./proxy");
  return proxy(new NextRequest(`https://tienda.example${ruta}`, { headers }), {} as never);
}

describe("proxy: el local no se recuerda", () => {
  it("el enlace con sucursal abre el catálogo filtrado y no guarda cookie", async () => {
    const r = await pedir("/catalogo?sucursal=mdp");
    expect(r?.status).toBe(307);
    expect(r?.headers.get("location")).toBe("https://tienda.example/catalogo?retiro=mdp");
    expect(r?.headers.get("set-cookie") ?? "").not.toContain("local_retiro");
  });

  it("con la cookie vieja puesta, el catálogo entra sin filtro de local", async () => {
    const r = await pedir("/catalogo?categoria=HOGAR", { cookie: "local_retiro=mdp" });
    expect(r?.status).not.toBe(307);
    expect(r?.headers.get("location")).toBeNull();
  });

  it("el enlace a la home no guarda nada", async () => {
    const r = await pedir("/?sucursal=mdp");
    expect(r?.status).not.toBe(307);
    expect(r?.headers.get("set-cookie") ?? "").not.toContain("local_retiro");
  });
});
