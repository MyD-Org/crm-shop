import { describe, expect, it } from "vitest";
import { instalarFbq, instalarGtag } from "./stubs";

describe("instalarFbq", () => {
  it("deja una cola con autoConfig apagado e init, y encola lo que venga", () => {
    const w = {} as Window;
    instalarFbq(w, "1234567890");
    w.fbq!("track", "PageView");
    const cola = (w.fbq as unknown as { queue: IArguments[] }).queue.map((a) => [...a]);
    expect(cola).toEqual([
      ["set", "autoConfig", false, "1234567890"],
      ["init", "1234567890"],
      ["track", "PageView"],
    ]);
  });

  it("idempotente: no pisa un fbq existente", () => {
    const w = {} as Window;
    instalarFbq(w, "1");
    const primero = w.fbq;
    instalarFbq(w, "1");
    expect(w.fbq).toBe(primero);
  });
});

describe("instalarGtag", () => {
  it("dataLayer con js y config sin page_view automático", () => {
    const w = {} as Window;
    instalarGtag(w, "G-ABC123");
    const dl = w.dataLayer!.map((a) => [...(a as IArguments)]);
    expect(dl[0][0]).toBe("js");
    expect(dl[1]).toEqual(["config", "G-ABC123", { send_page_view: false }]);
  });
});
