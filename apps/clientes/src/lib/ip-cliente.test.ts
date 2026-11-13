import { describe, expect, it } from "vitest";
import { ipDelRequest } from "./ip-cliente";

const req = (headers: Record<string, string>) => new Request("https://shop.example/x", { headers });

describe("ipDelRequest", () => {
  it("toma la primera IP de x-forwarded-for (la pone Vercel)", () => {
    expect(ipDelRequest(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" }))).toBe("203.0.113.7");
  });

  it("recorta espacios", () => {
    expect(ipDelRequest(req({ "x-forwarded-for": "  203.0.113.7  " }))).toBe("203.0.113.7");
  });

  it("sin x-forwarded-for cae a x-real-ip", () => {
    expect(ipDelRequest(req({ "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
  });

  it("x-forwarded-for vacío cae a x-real-ip", () => {
    expect(ipDelRequest(req({ "x-forwarded-for": " , ", "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
  });

  it("x-forwarded-for tiene prioridad sobre x-real-ip", () => {
    expect(ipDelRequest(req({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "198.51.100.9" }))).toBe("203.0.113.7");
  });

  it("sin ninguna: null", () => {
    expect(ipDelRequest(req({}))).toBeNull();
  });

  it("descarta valores que no parecen una IP (se usan como clave de rate limit)", () => {
    expect(ipDelRequest(req({ "x-forwarded-for": "no es una ip" }))).toBeNull();
    expect(ipDelRequest(req({ "x-forwarded-for": "a".repeat(200) }))).toBeNull();
  });

  it("acepta IPv6", () => {
    expect(ipDelRequest(req({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8::1");
  });
});
