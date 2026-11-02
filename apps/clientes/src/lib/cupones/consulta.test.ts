import { beforeEach, describe, expect, it, vi } from "vitest";

const permitirAsync = vi.fn(async (..._a: unknown[]) => true);
const resolverCupon = vi.fn(async () => null);
vi.mock("../rate-limit", () => ({ permitirAsync: (...a: unknown[]) => permitirAsync(...a) }));
vi.mock("./repo", () => ({ resolverCupon: () => resolverCupon() }));

import { consultarCupon } from "./consulta";

beforeEach(() => permitirAsync.mockClear());

describe("consultarCupon", () => {
  it("por cuenta 60 cada 10 minutos; por IP (invitados detrás de un CGNAT) bastante más", async () => {
    await consultarCupon("LUZ-7KQ2M", null, "user_1");
    await consultarCupon("LUZ-7KQ2M", null, "ip:203.0.113.9");
    expect(permitirAsync.mock.calls[0]).toEqual(["cupon:user_1", 60, 600_000]);
    expect(permitirAsync.mock.calls[1]).toEqual(["cupon:ip:203.0.113.9", 300, 600_000]);
  });
  it("sin código no consulta ni cuenta", async () => {
    expect(await consultarCupon("", null, "user_1")).toBeNull();
    expect(permitirAsync).not.toHaveBeenCalled();
  });
});
