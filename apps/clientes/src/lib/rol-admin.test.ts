import { describe, expect, it } from "vitest";
import { esRolAdmin } from "./rol-admin";

describe("esRolAdmin", () => {
  it("true cuando role === \"admin\"", () => {
    expect(esRolAdmin({ role: "admin" })).toBe(true);
  });

  it("false con otro valor o tipo de role (case, sinónimo, booleano, array)", () => {
    expect(esRolAdmin({ role: "Admin" })).toBe(false);
    expect(esRolAdmin({ role: "administrador" })).toBe(false);
    expect(esRolAdmin({ role: true })).toBe(false);
    expect(esRolAdmin({ role: ["admin"] })).toBe(false);
  });

  it("false sin metadata o con metadata vacía", () => {
    expect(esRolAdmin({})).toBe(false);
    expect(esRolAdmin(null)).toBe(false);
    expect(esRolAdmin(undefined)).toBe(false);
  });

  it("false con tipos que no son objeto", () => {
    expect(esRolAdmin("admin")).toBe(false);
  });
});
