import { describe, expect, it } from "vitest";
import { formaDelTipoInfo, motivoFormaDistinta } from "./forma-cobro";

describe("formaDelTipoInfo", () => {
  it("mapea los tipos conocidos", () => {
    expect(formaDelTipoInfo("credito")).toBe("credito");
    expect(formaDelTipoInfo("debito")).toBe("debito");
    expect(formaDelTipoInfo("prepaga")).toBe("debito");
    expect(formaDelTipoInfo("dinero_en_cuenta")).toBe("cuenta_mp");
  });
  it("tipo ausente o desconocido no mapea", () => {
    expect(formaDelTipoInfo(undefined)).toBeNull();
    expect(formaDelTipoInfo(null)).toBeNull();
    expect(formaDelTipoInfo("ticket")).toBeNull();
  });
});

describe("motivoFormaDistinta", () => {
  it("acusa cuando el tipo real difiere de la forma congelada", () => {
    expect(motivoFormaDistinta("debito", "credito")).toBe("forma_distinta");
    expect(motivoFormaDistinta("credito", "debito")).toBe("forma_distinta");
    expect(motivoFormaDistinta("cuenta_mp", "credito")).toBe("forma_distinta");
  });
  it("coincide: no acusa", () => {
    expect(motivoFormaDistinta("credito", "credito")).toBeNull();
    expect(motivoFormaDistinta("cuenta_mp", "dinero_en_cuenta")).toBeNull();
  });
  it("prepaga cuenta como débito", () => {
    expect(motivoFormaDistinta("debito", "prepaga")).toBeNull();
    expect(motivoFormaDistinta("credito", "prepaga")).toBe("forma_distinta");
  });
  it("tipo ausente no acusa", () => {
    expect(motivoFormaDistinta("debito", undefined)).toBeNull();
    expect(motivoFormaDistinta("debito", "ticket")).toBeNull();
  });
  it("forma_cobro NULL nunca acusa", () => {
    expect(motivoFormaDistinta(null, "credito")).toBeNull();
    expect(motivoFormaDistinta(undefined, "debito")).toBeNull();
  });
});
