"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Field, Input } from "@myd-org/ui";
import { Footer } from "@/components/Footer";

type Pago = "transferencia" | "efectivo";
type Envio = "envio" | "retiro";

const CIUDADES_ENVIO = ["El Dorado", "Iguazu"];

function CheckCircleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function RadioCard({
  selected,
  onClick,
  title,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
        selected
          ? "border-primary bg-primary/5"
          : "border-border bg-surface hover:border-border-strong"
      }`}
    >
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
          selected ? "border-primary bg-primary text-white" : "border-border"
        }`}
      >
        {selected && (
          <span className="h-2 w-2 rounded-full bg-white" />
        )}
      </span>
      <span>
        <span className="block text-sm font-semibold text-text">{title}</span>
        {description && (
          <span className="mt-0.5 block text-xs text-muted">{description}</span>
        )}
      </span>
    </button>
  );
}

const RESUMEN = [
  { name: "Panel LED 48W 60x60 embutir", qty: 2, price: 14990 },
  { name: "Cable unipolar 2.5mm x 100m", qty: 1, price: 45000 },
  { name: "Lampara LED A60 12W E27", qty: 5, price: 3200 },
];

export default function CheckoutPage() {
  const [pago, setPago] = useState<Pago>("transferencia");
  const [envio, setEnvio] = useState<Envio>("retiro");
  const [ciudad, setCiudad] = useState("");
  const [direccion, setDireccion] = useState("");
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [confirmado, setConfirmado] = useState(false);

  const subtotal = RESUMEN.reduce((a, i) => a + i.price * i.qty, 0);
  const iva = Math.round(subtotal * 0.21);
  const total = subtotal + iva;
  const fmt = (n: number) =>
    n.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0 });

  const canConfirm =
    nombre.trim() &&
    telefono.trim() &&
    (envio === "retiro" || (ciudad && direccion.trim()));

  if (confirmado) {
    return (
      <>
        <main className="mx-auto flex max-w-lg flex-1 flex-col items-center gap-5 px-4 py-20 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10 text-success">
            <CheckCircleIcon />
          </span>
          <h1 className="text-2xl font-extrabold text-text">Pedido recibido</h1>
          <p className="text-sm text-muted">
            Nos vamos a comunicar con vos a la brevedad para coordinar el{" "}
            {envio === "envio" ? "envio" : "retiro"} y el pago por{" "}
            {pago === "transferencia" ? "transferencia bancaria" : "efectivo en el local"}.
          </p>
          <Link href="/">
            <Button>Volver al inicio</Button>
          </Link>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>

      <main className="mx-auto max-w-7xl flex-1 px-4 py-8">
        <nav className="mb-6 text-sm text-muted">
          <Link href="/carrito" className="hover:text-primary">Carrito</Link>
          {" / "}
          <span className="text-text">Finalizar pedido</span>
        </nav>

        <h1 className="mb-6 text-2xl font-extrabold text-text">Finalizar pedido</h1>

        <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
          {/* Formulario */}
          <div className="space-y-8">

            {/* Datos de contacto */}
            <section>
              <h2 className="mb-4 text-base font-bold text-text">Datos de contacto</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nombre y apellido">
                  <Input
                    placeholder="Juan Perez"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                  />
                </Field>
                <Field label="Telefono">
                  <Input
                    placeholder="+54 376 4000000"
                    value={telefono}
                    onChange={(e) => setTelefono(e.target.value)}
                  />
                </Field>
              </div>
            </section>

            {/* Forma de envio */}
            <section>
              <h2 className="mb-4 text-base font-bold text-text">Entrega</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <RadioCard
                  selected={envio === "retiro"}
                  onClick={() => setEnvio("retiro")}
                  title="Retiro / Coordinar"
                  description="Retira en el local o coordinamos entrega"
                />
                <RadioCard
                  selected={envio === "envio"}
                  onClick={() => setEnvio("envio")}
                  title="Envio a domicilio"
                  description="Solo El Dorado e Iguazu"
                />
              </div>

              {envio === "envio" && (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field label="Ciudad">
                    <select
                      value={ciudad}
                      onChange={(e) => setCiudad(e.target.value)}
                      className="w-full rounded-sm border-[1.5px] border-border-strong bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:border-primary"
                    >
                      <option value="">Seleccionar ciudad</option>
                      {CIUDADES_ENVIO.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Direccion">
                    <Input
                      placeholder="Av. San Martin 1234"
                      value={direccion}
                      onChange={(e) => setDireccion(e.target.value)}
                    />
                  </Field>
                </div>
              )}
            </section>

            {/* Forma de pago */}
            <section>
              <h2 className="mb-4 text-base font-bold text-text">Forma de pago</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <RadioCard
                  selected={pago === "transferencia"}
                  onClick={() => setPago("transferencia")}
                  title="Transferencia bancaria"
                  description="Te enviamos los datos al confirmar"
                />
                <RadioCard
                  selected={pago === "efectivo"}
                  onClick={() => setPago("efectivo")}
                  title="Efectivo en el local"
                  description="Pago al momento del retiro"
                />
              </div>
            </section>
          </div>

          {/* Resumen */}
          <div className="h-fit rounded-xl border border-border bg-surface p-5 lg:sticky lg:top-24">
            <h2 className="mb-4 text-base font-bold text-text">Resumen</h2>

            <ul className="mb-4 space-y-3">
              {RESUMEN.map((item) => (
                <li key={item.name} className="flex justify-between gap-2 text-sm">
                  <span className="text-muted">
                    {item.name}
                    <span className="ml-1 text-xs">x{item.qty}</span>
                  </span>
                  <span className="shrink-0 font-medium text-text">
                    {fmt(item.price * item.qty)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="space-y-2 border-t border-border pt-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Subtotal</span>
                <span className="font-medium">{fmt(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">IVA (21%)</span>
                <span className="font-medium">{fmt(iva)}</span>
              </div>
              <div className="flex justify-between pt-2">
                <span className="font-bold text-text">Total</span>
                <span className="text-lg font-extrabold text-text">{fmt(total)}</span>
              </div>
              <p className="text-xs text-muted">Precio sin impuestos {fmt(subtotal)}</p>
            </div>

            <Button
              className="mt-5 w-full"
              disabled={!canConfirm}
              onClick={() => setConfirmado(true)}
            >
              Confirmar pedido
            </Button>

            {!canConfirm && (
              <p className="mt-2 text-center text-xs text-muted">
                Complete todos los campos para continuar
              </p>
            )}
          </div>
        </div>
      </main>

      <Footer />
    </>
  );
}
