import { describe, expect, it } from "vitest";
import { avatarChat } from "./chat-ia-textos";

describe("avatarChat", () => {
  it("la tienda de Central: su avatar de siempre", () => {
    expect(avatarChat({ recursosCentral: true })).toBe("/images/central-led/avatar.jpg");
  });

  it("con logo propio: ese", () => {
    expect(avatarChat({ logoUrl: "https://media.example/l.svg", recursosCentral: false })).toBe("https://media.example/l.svg");
  });

  it("otra marca sin logo: sin avatar, nunca el de Central", () => {
    expect(avatarChat({ recursosCentral: false })).toBeUndefined();
  });
});
