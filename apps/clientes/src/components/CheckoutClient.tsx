"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Button, Field, Input } from "@myd-org/ui";
import { useCart } from "@/context/CartContext";
import { useCotizacion } from "@/hooks/useCotizacion";
import { PagoMercadoPago } from "@/components/PagoMercadoPago";
import { fmtPrecio } from "@/lib/format";
import {
  CIUDADES_ENVIO,
  PAGO_LABEL,
  pagosDisponibles,
  type EntregaTipo,
  type PagoMetodo,
} from "@/lib/envio";

function CheckCircleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

function RadioCard({
  selected,
  onClick,
  title,
  description,
  disabled,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
        selected
          ? "border-primary bg-primary/5"
          : "border-border bg-surface enabled:hover:border-border-strong"
      }`}
    >
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
          selected ? "border-primary bg-primary text-white" : "border-border"
        }`}
      >
        {selected && <span className="h-2 w-2 rounded-full bg-white" />}
      </span>
      <span>
        <span className="block text-sm font-semibold text-text">{title}</span>
        {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
      </span>
    </button>
  );
}

/**
 * Qué le pasa al comprador con cada medio. Es un mapa y no un ternario porque
 * antes lo era: `transferencia` tenía su texto y TODO el resto heredaba "pagás
 * al momento del retiro", así que al sumar Mercado Pago la tarjeta decía que se
 * pagaba después. Con un Record, agregar un medio sin su texto no compila.
 */
const DESCRIPCION_PAGO: Record<PagoMetodo, string> = {
  transferencia: "Te pasamos el CBU al confirmar el pedido",
  efectivo: "Pagás al momento del retiro",
  cuenta_corriente: "Se carga a tu cuenta corriente",
  mercadopago: "Pagás ahora con tarjeta, en cuotas si querés",
};

interface Props {
  nombreSugerido: string;
  emailCliente?: string;
  /** El perfil fiscal está completo: sin esto no se puede emitir la factura. */
  facturacionCompleta: boolean;
}

export function CheckoutClient({
  nombreSugerido,
  emailCliente,
  facturacionCompleta,
}: Props) {
  const { items, clear, ready } = useCart();

  const [pago, setPago] = useState<PagoMetodo>("transferencia");
  const [entrega, setEntrega] = useState<EntregaTipo>("retiro");
  const [ciudad, setCiudad] = useState("");
  const [direccion, setDireccion] = useState("");
  const [nombre, setNombre] = useState(nombreSugerido);
  const [telefono, setTelefono] = useState("");
  const [notas, setNotas] = useState("");

  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  /**
   * El pedido ya existe en la base. Se guarda el total además del número porque
   * el carrito se vacía en este mismo paso y la cotización deja de estar
   * disponible — y el brick necesita un monto para mostrar.
   */
  const [confirmado, setConfirmado] = useState<{
    numero: string;
    id: string;
    total: number;
  } | null>(null);
  const [pagado, setPagado] = useState(false);

  /**
   * Clave del intento de compra. Se genera en el PRIMER confirmar y se reusa en
   * cada reintento, que es lo que la vuelve útil.
   *
   * El caso que resuelve no es el doble clic —eso ya lo tapa el botón
   * deshabilitado— sino el peor: el POST llega, el pedido se crea, y la
   * respuesta se pierde. Abajo eso se muestra como "no pudimos conectarnos", el
   * cliente reintenta, y sin esta clave quedan dos pedidos por una sola compra.
   *
   * En un `ref` y no en `useState` porque cambiarla no tiene que repintar nada.
   * Se genera acá y no en el render para no llamar a `crypto` durante el SSR.
   */
  const claveIntento = useRef<string | null>(null);

  const { cotizacion, estado, error, recotizar } = useCotizacion({
    entregaTipo: entrega,
    ciudad: entrega === "envio" ? ciudad : undefined,
    // Una vez confirmado el carrito queda vacío: no tiene sentido recotizar.
    activo: !confirmado,
  });

  const metodosPago = pagosDisponibles(entrega);

  // Efectivo solo existe con retiro. Si el cliente lo eligió y después pasó a
  // envío, el método se corrige DERIVÁNDOLO en el render — no sincronizando el
  // estado desde un efecto, que agrega un render de más y un frame donde el
  // formulario muestra una opción que el servidor va a rechazar.
  const pagoElegido: PagoMetodo = metodosPago.includes(pago) ? pago : metodosPago[0];

  const envioDisponible = cotizacion?.envio.disponible ?? false;
  const datosCompletos =
    nombre.trim() !== "" &&
    telefono.trim() !== "" &&
    (entrega === "retiro" || (ciudad !== "" && direccion.trim() !== ""));

  const puedeConfirmar =
    estado === "ok" &&
    !!cotizacion &&
    !cotizacion.hayProblemas &&
    cotizacion.lineas.length > 0 &&
    datosCompletos &&
    facturacionCompleta &&
    (entrega === "retiro" || envioDisponible) &&
    !enviando;

  async function confirmar() {
    setEnviando(true);
    setErrorEnvio(null);

    // `randomUUID` pide contexto seguro (https o localhost). Si no está, se
    // manda sin clave: se pierde la protección contra el duplicado, pero la
    // compra sigue andando. Romper el checkout sería peor que el problema.
    if (!claveIntento.current) {
      claveIntento.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : null;
    }

    try {
      const res = await fetch("/api/pedidos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: claveIntento.current ?? undefined,
          items: items.map((i) => ({ id: i.id, qty: i.qty })),
          contactoNombre: nombre,
          contactoTelefono: telefono,
          entregaTipo: entrega,
          entregaCiudad: entrega === "envio" ? ciudad : undefined,
          entregaDireccion: entrega === "envio" ? direccion : undefined,
          pagoMetodo: pagoElegido,
          notas,
        }),
      });

      const json = await res.json();

      if (res.status === 409) {
        // El servidor recotizó y algo cambió. Se refresca la vista para que el
        // cliente vea QUÉ cambió en vez de un error suelto.
        setErrorEnvio(json?.error ?? "El pedido cambió. Revisalo.");
        recotizar();
        return;
      }
      if (!res.ok) {
        setErrorEnvio(json?.error ?? "No pudimos registrar el pedido.");
        return;
      }

      // El carrito se vacía SOLO después del 201: si se limpiaba antes y el
      // POST fallaba, el cliente perdía el carrito sin haber comprado nada.
      // A partir de acá el registro de la compra es el pedido, no el carrito:
      // si el pago falla, el pedido queda y se puede reintentar sin rehacer nada.
      setConfirmado({
        numero: json.numero,
        id: json.id,
        total: json.cotizacion?.total ?? cotizacion?.total ?? 0,
      });
      clear();
    } catch {
      setErrorEnvio("No pudimos conectarnos. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  // ------------------------------------------------------- pedido creado, a pagar
  //
  // El pedido YA existe cuando se llega acá. Si el cobro falla, no se pierde
  // nada: queda pendiente y se puede pagar después desde "Mis pedidos" o por
  // transferencia. Por eso el pedido se crea antes de intentar cobrar y no al
  // revés.
  if (confirmado && pagoElegido === "mercadopago" && !pagado) {
    return (
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-5 px-4 py-10">
        <div className="text-center">
          <h1 className="text-2xl font-extrabold text-text">Pagá tu pedido</h1>
          <p className="mt-1 text-sm font-semibold text-text">{confirmado.numero}</p>
          <p className="mt-2 text-sm text-muted">
            Ya guardamos tu pedido. Si algo falla con la tarjeta, no lo perdés:
            podés pagarlo más tarde o por transferencia.
          </p>
        </div>

        <PagoMercadoPago
          pedidoId={confirmado.id}
          numero={confirmado.numero}
          monto={confirmado.total}
          emailComprador={emailCliente}
          onPagado={() => setPagado(true)}
        />

        <Link href="/mi-cuenta" className="text-center text-sm text-muted underline">
          Prefiero pagarlo después
        </Link>
      </main>
    );
  }

  // ------------------------------------------------------------------ éxito
  if (confirmado) {
    return (
      <main className="mx-auto flex max-w-lg flex-1 flex-col items-center gap-5 px-4 py-20 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10 text-success">
          <CheckCircleIcon />
        </span>
        <h1 className="text-2xl font-extrabold text-text">
          {pagado ? "¡Pago acreditado!" : "Pedido recibido"}
        </h1>
        <p className="text-sm font-semibold text-text">{confirmado.numero}</p>
        <p className="text-sm text-muted">
          {pagado ? (
            <>
              Ya cobramos tu pedido. Nos comunicamos con vos para coordinar el{" "}
              {entrega === "envio" ? "envío" : "retiro"}.
            </>
          ) : (
            <>
              Nos vamos a comunicar con vos para coordinar el{" "}
              {entrega === "envio" ? "envío" : "retiro"} y el pago por{" "}
              {PAGO_LABEL[pagoElegido].toLowerCase()}.
            </>
          )}
          {emailCliente && <> Te mandamos el detalle a {emailCliente}.</>}
        </p>
        <div className="flex gap-3">
          <Link href="/mi-cuenta">
            <Button>Ver mis pedidos</Button>
          </Link>
          <Link href="/catalogo">
            <Button variant="secondary">Seguir comprando</Button>
          </Link>
        </div>
      </main>
    );
  }

  // ---------------------------------------------------------- carrito vacío
  if (ready && items.length === 0) {
    return (
      <main className="mx-auto flex max-w-7xl flex-1 flex-col items-center justify-center gap-4 px-4 py-20">
        <p className="text-2xl font-bold text-text">Tu carrito está vacío</p>
        <Link href="/catalogo">
          <Button>Ver catálogo</Button>
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl flex-1 px-4 py-8">
      <nav className="mb-6 text-sm text-muted">
        <Link href="/carrito" className="hover:text-primary">Carrito</Link>
        {" / "}
        <span className="text-text">Finalizar pedido</span>
      </nav>

      <h1 className="mb-6 text-2xl font-extrabold text-text">Finalizar pedido</h1>

      {!facturacionCompleta && (
        <div className="mb-6 rounded-xl border border-warning/40 bg-warning/5 p-4">
          <p className="text-sm font-semibold text-text">
            Falta cargar tus datos de facturación
          </p>
          <p className="mt-1 text-sm text-muted">
            Los necesitamos para emitirte la factura de esta compra. Se cargan
            una sola vez.
          </p>
          <Link
            href="/mi-cuenta"
            className="mt-3 inline-block text-sm font-semibold text-primary hover:underline"
          >
            Cargar mis datos →
          </Link>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
        {/* ------------------------------------------------------ formulario */}
        <div className="space-y-8">
          <section>
            <h2 className="mb-4 text-base font-bold text-text">Datos de contacto</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nombre y apellido">
                <Input
                  placeholder="Juan Pérez"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                />
              </Field>
              <Field label="Teléfono">
                <Input
                  type="tel"
                  placeholder="+54 376 4000000"
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                />
              </Field>
            </div>
          </section>

          <section>
            <h2 className="mb-4 text-base font-bold text-text">Entrega</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <RadioCard
                selected={entrega === "retiro"}
                onClick={() => setEntrega("retiro")}
                title="Retiro en local / a coordinar"
                description="Retirás en el local o coordinamos la entrega con vos"
              />
              <RadioCard
                selected={entrega === "envio"}
                onClick={() => setEntrega("envio")}
                title="Envío a domicilio"
                description={`Sin cargo a ${CIUDADES_ENVIO.join(" y ")}`}
              />
            </div>

            {entrega === "envio" && (
              <>
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
                  <Field label="Dirección">
                    <Input
                      placeholder="Av. San Martín 1234"
                      value={direccion}
                      onChange={(e) => setDireccion(e.target.value)}
                    />
                  </Field>
                </div>

                {cotizacion && !envioDisponible && cotizacion.envio.motivo && (
                  <p className="mt-3 flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-xs text-text">
                    <span className="mt-px text-warning"><AlertIcon /></span>
                    {cotizacion.envio.motivo}
                  </p>
                )}
              </>
            )}
          </section>

          <section>
            <h2 className="mb-4 text-base font-bold text-text">Forma de pago</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {metodosPago.map((m) => (
                <RadioCard
                  key={m}
                  selected={pagoElegido === m}
                  onClick={() => setPago(m)}
                  title={PAGO_LABEL[m]}
                  description={DESCRIPCION_PAGO[m]}
                />
              ))}
            </div>
            {entrega === "envio" && (
              <p className="mt-3 text-xs text-muted">
                El pago en efectivo solo está disponible si retirás por el local.
              </p>
            )}
          </section>

          <section>
            <h2 className="mb-4 text-base font-bold text-text">
              Aclaraciones <span className="font-normal text-muted">(opcional)</span>
            </h2>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Horario de entrega, referencia del domicilio, etc."
              className="w-full rounded-sm border-[1.5px] border-border-strong bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:border-primary"
            />
          </section>
        </div>

        {/* --------------------------------------------------------- resumen */}
        <div className="h-fit rounded-xl border border-border bg-surface p-5 lg:sticky lg:top-24">
          <h2 className="mb-4 text-base font-bold text-text">Resumen</h2>

          {estado === "cargando" && !cotizacion && (
            <p className="mb-4 text-sm text-muted">Confirmando precios y stock…</p>
          )}

          {estado === "error" && (
            <div className="mb-4 rounded-lg bg-danger/5 p-3 text-xs">
              <p className="text-danger">{error}</p>
              <button onClick={recotizar} className="mt-1 font-semibold text-primary hover:underline">
                Reintentar
              </button>
            </div>
          )}

          <ul className="mb-4 space-y-3">
            {cotizacion?.lineas.map((linea) => (
              <li key={linea.id} className="flex justify-between gap-2 text-sm">
                <span className={linea.problema ? "text-danger" : "text-muted"}>
                  {linea.name}
                  <span className="ml-1 text-xs">x{linea.qty}</span>
                  {linea.problema && (
                    <span className="mt-0.5 block text-xs">{linea.detalle}</span>
                  )}
                </span>
                <span className="shrink-0 font-medium text-text">
                  {linea.problema ? "—" : fmtPrecio(linea.subtotal)}
                </span>
              </li>
            ))}
          </ul>

          <div className="space-y-2 border-t border-border pt-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Subtotal</span>
              <span className="font-medium">{fmtPrecio(cotizacion?.subtotal ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">IVA</span>
              <span className="font-medium">{fmtPrecio(cotizacion?.iva ?? 0)}</span>
            </div>
            {entrega === "envio" && (
              <div className="flex justify-between">
                <span className="text-muted">Envío</span>
                <span className="font-medium text-success">Sin cargo</span>
              </div>
            )}
            <div className="flex justify-between pt-2">
              <span className="font-bold text-text">Total</span>
              <span className="text-lg font-extrabold text-text">
                {fmtPrecio(cotizacion?.total ?? 0)}
              </span>
            </div>
            <p className="text-xs text-muted">
              Precio sin impuestos {fmtPrecio(cotizacion?.subtotal ?? 0)}
            </p>
          </div>

          {errorEnvio && (
            <p className="mt-4 rounded-lg bg-danger/5 p-3 text-xs text-danger">{errorEnvio}</p>
          )}

          <Button className="mt-5 w-full" disabled={!puedeConfirmar} onClick={confirmar}>
            {enviando ? "Confirmando…" : "Confirmar pedido"}
          </Button>

          {!puedeConfirmar && !enviando && (
            <p className="mt-2 text-center text-xs text-muted">
              {!facturacionCompleta
                ? "Cargá tus datos de facturación para continuar."
                : cotizacion?.hayProblemas
                  ? "Revisá los productos marcados en rojo."
                  : !datosCompletos
                    ? "Completá todos los campos para continuar."
                    : entrega === "envio" && !envioDisponible
                      ? "Revisá la opción de envío."
                      : "Confirmando precios y stock…"}
            </p>
          )}

          <p className="mt-3 text-center text-xs text-muted">
            No se te cobra nada ahora. Coordinamos el pago al confirmar el pedido.
          </p>
        </div>
      </div>
    </main>
  );
}
