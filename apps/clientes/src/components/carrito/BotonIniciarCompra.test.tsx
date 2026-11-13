import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const track = vi.fn();
vi.mock("@/lib/tracking/track", () => ({ track: (e: unknown) => track(e) }));
// next/link y el DS no hacen falta: se llama al componente como función y se mira el árbol.
vi.mock("next/link", () => ({ default: () => null }));
vi.mock("@myd-org/ui", () => ({ Button: () => null }));

import { BotonIniciarCompra } from "./BotonIniciarCompra";

const items = [
  { price: 100, qty: 2 },
  { price: 50.5, qty: 1 },
];

function alTocar(props: Parameters<typeof BotonIniciarCompra>[0]) {
  const el = BotonIniciarCompra(props) as ReactElement<{ onClick: () => void }>;
  el.props.onClick();
}

describe("BotonIniciarCompra", () => {
  beforeEach(() => track.mockReset());

  it("anónimo: emite checkout_requiere_ingreso con líneas y total, sin datos personales", () => {
    alTocar({ anonimo: true, items, total: 300 });
    expect(track).toHaveBeenCalledOnce();
    expect(track).toHaveBeenCalledWith({ tipo: "checkout_requiere_ingreso", items: 2, valor: 300 });
  });

  it("anónimo sin cotización todavía: valor referencial por precio × cantidad", () => {
    alTocar({ anonimo: true, items, total: null });
    expect(track).toHaveBeenCalledWith({ tipo: "checkout_requiere_ingreso", items: 2, valor: 250.5 });
  });

  it("anónimo con el flag compra-invitado: /checkout ya no es un muro, no emite", () => {
    alTocar({ anonimo: true, compraInvitado: true, items, total: 300 });
    expect(track).not.toHaveBeenCalled();
  });

  it("usuario con sesión: no emite", () => {
    alTocar({ anonimo: false, items, total: 300 });
    expect(track).not.toHaveBeenCalled();
  });

  it("el evento sale en el click, antes de que el Link navegue a /checkout", () => {
    const el = BotonIniciarCompra({ anonimo: true, items, total: 1 }) as ReactElement<{ href: string; onClick: () => void }>;
    expect(el.props.href).toBe("/checkout");
    expect(typeof el.props.onClick).toBe("function");
  });
});
