"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Field, Input, useToast } from "@myd-org/ui";
import {
  ORDER_ESTADO_LABEL,
  PAGO_ESTADO_LABEL,
  type Order,
  type OrderEstado,
  type OrderSummary,
} from "@/data/orders";
import { useClerk } from "@clerk/nextjs";
import { useCart } from "@/context/CartContext";
import { fmtPrecio as fmt, fmtFecha } from "@/lib/format";
import { FacturacionForm, type PerfilFacturacionUI } from "./FacturacionForm";
import { DireccionAutocomplete } from "./DireccionAutocomplete";

const CRM_URL = process.env.NEXT_PUBLIC_CRM_URL ?? "https://crm.cliente.example";

const ESTADO_COLOR: Record<OrderEstado, string> = {
  pendiente: "#64748b",
  confirmado: "#2563eb",
  preparacion: "#d97706",
  en_camino: "#2563eb",
  entregado: "#16a34a",
  cancelado: "#dc2626",
};

/* ── Icons ─────────────────────────────────────────────── */

function LightbulbIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 7 7c0 3.5-2 5.5-2.5 6.5H7.5C7 15.5 5 13.5 5 9a7 7 0 0 1 7-7z" />
    </svg>
  );
}
function ArrowRightIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
    </svg>
  );
}
function RefreshIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}
function TruckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 3h15v13H1z" /><path d="M16 8h4l3 3v5h-7V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  );
}
function CardIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}
function BagIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}

/* ── Estado pill ───────────────────────────────────────── */

function EstadoPill({ estado }: { estado: OrderEstado }) {
  const color = ESTADO_COLOR[estado];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ background: `${color}1a`, color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {ORDER_ESTADO_LABEL[estado]}
    </span>
  );
}

/* ── Order card ────────────────────────────────────────── */

function OrderCard({ order }: { order: Order }) {
  // El total sale del pedido, no de sumar las líneas: es el número congelado
  // que se le prometió al cliente, con su IVA real y su envío.
  const unidades = order.items.reduce((acc, i) => acc + i.qty, 0);
  const esEnvio = order.metodoEntrega.toLowerCase().includes("env");
  const { addItem } = useCart();
  const { toast } = useToast();
  const router = useRouter();

  function volverAComprar() {
    for (const item of order.items) {
      addItem({ id: item.id, name: item.name, brand: item.brand, price: item.price }, item.qty);
    }
    toast({
      title: "Productos agregados al carrito",
      description: "Confirmamos precio y stock actuales en el carrito.",
      tone: "success",
      action: { label: "Ver carrito", href: "/carrito" },
    });
    router.push("/carrito");
  }

  return (
    <div className="rounded-xl border border-border bg-surface">
      {/* Cabecera */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <div className="flex flex-col">
          <span className="text-sm font-bold text-text">Pedido {order.numero}</span>
          <span className="text-xs text-muted">{fmtFecha(order.fecha)}</span>
        </div>
        <div className="flex items-center gap-2">
          {order.pagoEstado !== "pagado" && (
            <span className="rounded-full bg-elevated px-2.5 py-1 text-xs font-semibold text-muted">
              {PAGO_ESTADO_LABEL[order.pagoEstado]}
            </span>
          )}
          <EstadoPill estado={order.estado} />
        </div>
      </div>

      {/* Items */}
      <div className="divide-y divide-border">
        {order.items.map((item) => (
          <Link
            key={item.id}
            href={`/producto/${item.id}`}
            className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-elevated"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-elevated text-muted/40">
              <LightbulbIcon />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-text">{item.name}</p>
              <p className="text-xs text-muted">{item.qty} u. · {fmt(item.price)} c/u</p>
            </div>
            <p className="shrink-0 text-sm font-semibold text-text">{fmt(item.total)}</p>
          </Link>
        ))}
      </div>

      {/* Resumen del pedido */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-elevated/40 px-5 py-3">
        <span className="flex items-center gap-1.5 text-xs text-muted">
          {esEnvio ? <TruckIcon /> : <BagIcon />}
          {order.metodoEntrega} · {order.metodoPago}
        </span>
        <span className="text-sm text-text">
          {unidades} {unidades === 1 ? "producto" : "productos"} ·{" "}
          <span className="font-extrabold">{fmt(order.total)}</span>
          <span className="ml-1 text-xs text-muted">IVA incl.</span>
        </span>
      </div>

      {/* Acciones */}
      <div className="flex flex-wrap items-center gap-3 px-5 py-3.5">
        <Link href={`/mi-cuenta/pedido/${order.id}`}>
          <button className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-accent hover:text-white">
            Ver detalle <ArrowRightIcon />
          </button>
        </Link>
        <button
          onClick={volverAComprar}
          className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-elevated"
        >
          <RefreshIcon />
          Volver a comprar
        </button>
        {esEnvio && order.entregaDireccion && (
          <span className="ml-auto flex items-center gap-2 text-sm font-medium text-muted">
            <TruckIcon />
            {order.entregaDireccion}
            {order.entregaCiudad ? `, ${order.entregaCiudad}` : ""}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Tabs ──────────────────────────────────────────────── */

type Tab = "compras" | "datos" | "direcciones";

const TABS: { value: Tab; label: string }[] = [
  { value: "compras", label: "Mis compras" },
  { value: "datos", label: "Mis datos" },
  { value: "direcciones", label: "Direcciones" },
];

/* ── Main ──────────────────────────────────────────────── */

export function MisCompras({
  nombre,
  cuit,
  email,
  esCuentaCorriente,
  razonSocialVinculada,
  perfilFacturacion,
  pedidos,
  resumen,
}: {
  nombre: string;
  cuit?: string;
  email?: string;
  esCuentaCorriente: boolean;
  /** Perfil de facturación cargado por el cliente. null = todavía no lo cargó. */
  perfilFacturacion: PerfilFacturacionUI | null;
  /**
   * Razon social del cliente de Alegra al que esta vinculada la cuenta.
   * undefined = todavia no vinculo ninguna (compra a lista general).
   */
  razonSocialVinculada?: string;
  /** Pedidos reales del cliente, cargados en el servidor. */
  pedidos: Order[];
  resumen: OrderSummary;
}) {
  const [tab, setTab] = useState<Tab>("compras");

  return (
    <div className="flex flex-col gap-6">
      {/* Breadcrumb */}
      <nav className="text-sm text-muted">
        <Link href="/" className="hover:text-primary">Inicio</Link>
        <span className="px-1.5">/</span>
        <span className="text-text">Mi cuenta</span>
      </nav>

      {/* Encabezado */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-text sm:text-3xl">Mis compras</h1>
          <p className="mt-1 text-sm text-muted">
            Hola, <span className="font-semibold text-text">{nombre}</span> · revisá el estado y el detalle de tus pedidos.
          </p>
        </div>
        {esCuentaCorriente && (
          <a
            href={`${CRM_URL}/portal/dashboard`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary transition-colors hover:bg-accent hover:text-white"
          >
            <CardIcon />
            Portal cuenta corriente
          </a>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-6 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`-mb-px border-b-2 pb-3 text-sm font-semibold transition-colors ${
              tab === t.value
                ? "border-primary text-primary"
                : "border-transparent text-muted hover:text-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "compras" && <ComprasTab pedidos={pedidos} resumen={resumen} />}
      {tab === "datos" && (
        <DatosTab
          cuit={cuit}
          email={email}
          perfilFacturacion={perfilFacturacion}
          razonSocialVinculada={razonSocialVinculada}
        />
      )}
      {tab === "direcciones" && <DireccionesTab />}
    </div>
  );
}

/* ── Tab: Mis compras ──────────────────────────────────── */

function ComprasTab({ pedidos, resumen }: { pedidos: Order[]; resumen: OrderSummary }) {
  return (
    <div className="flex flex-col gap-6">
      {/* Tarjetas resumen */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard label="Pedidos este año" value={String(resumen.pedidosEsteAnio)} />
        <SummaryCard
          label="En curso"
          value={`${resumen.enCurso} pedido${resumen.enCurso === 1 ? "" : "s"}`}
        />
        <SummaryCard label="Comprado este año" value={fmt(resumen.compradoEsteAnio)} />
      </div>

      {/* Lista de pedidos */}
      {pedidos.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface py-16 text-center">
          <p className="text-lg font-bold text-text">Todavía no hiciste compras</p>
          <Link href="/catalogo">
            <Button>Ver catálogo</Button>
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {pedidos.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-text">{value}</p>
    </div>
  );
}

/* ── Tab: Mis datos ────────────────────────────────────── */

function DatosTab({
  email,
  perfilFacturacion,
  razonSocialVinculada,
  cuit,
}: {
  email?: string;
  perfilFacturacion: PerfilFacturacionUI | null;
  razonSocialVinculada?: string;
  cuit?: string;
}) {
  const router = useRouter();
  const { openUserProfile } = useClerk();
  const vinculado = Boolean(razonSocialVinculada);

  return (
    <div className="flex flex-col gap-4">
      {/* Datos de acceso — los administra Clerk, no el shop */}
      <div className="rounded-xl border border-border bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-text">Datos de acceso</h2>
            <p className="mt-1 text-sm text-muted">
              Entrás con{" "}
              <span className="font-medium text-text">{email ?? "tu cuenta"}</span>.
            </p>
          </div>
          {/*
            Botón en vez de explicar dónde queda: `openUserProfile()` abre el
            panel de Clerk en un modal, acá mismo. Mandar al usuario a buscar un
            menú en otra esquina de la pantalla es hacerle hacer nuestro trabajo.
          */}
          <button
            onClick={() => openUserProfile()}
            className="shrink-0 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-text transition-colors hover:bg-elevated"
          >
            Editar mi cuenta
          </button>
        </div>
      </div>

      {/* Datos de facturación */}
      <div className="rounded-xl border border-border bg-surface p-6">
        <h2 className="text-base font-bold text-text">Datos de facturación</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {vinculado
            ? "Estos datos vienen de tu cuenta en nuestro sistema. Si algo está mal, escribinos y lo corregimos."
            : "Los necesitamos para emitirte la factura de tus compras."}
        </p>

        <div className="mt-5">
          <FacturacionForm
            perfil={perfilFacturacion}
            bloqueado={vinculado}
            onGuardado={() => router.refresh()}
          />
        </div>
      </div>

      <CuentaClienteCard
        razonSocialVinculada={razonSocialVinculada}
        cuit={cuit}
        coincideConAlegra={Boolean(perfilFacturacion?.coincideConAlegra)}
      />
    </div>
  );
}

/**
 * Estado de la vinculación con la cuenta de cliente de Alegra.
 *
 * Se llama "cuenta de cliente" y no "cuenta corriente" a propósito: en Alegra
 * también hay clientes de CONTADO, que no tienen cuenta corriente pero sí
 * historial, facturas y su propia lista de precios. Llamarlo "cuenta corriente"
 * dejaba afuera justamente a la mayoría.
 *
 * Vive acá y no en el header: le sirve a una minoría, y en el header ocupaba
 * lugar permanente a todos los demás.
 */
function CuentaClienteCard({
  razonSocialVinculada,
  cuit,
  coincideConAlegra,
}: {
  razonSocialVinculada?: string;
  cuit?: string;
  /** El documento que cargó ya existe como contacto en Alegra. */
  coincideConAlegra?: boolean;
}) {
  if (razonSocialVinculada) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-text">Tu cuenta de cliente</h2>
            <p className="mt-1 text-sm text-muted">
              Tu usuario está vinculado a{" "}
              <span className="font-semibold text-text">{razonSocialVinculada}</span>
              {cuit ? ` (CUIT ${cuit})` : ""}. Estás viendo tu lista de precios.
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
            Vinculada
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-base font-bold text-text">¿Ya sos cliente del local?</h2>

      {coincideConAlegra ? (
        // Detectamos el documento en Alegra pero NO vinculamos solo: hacerlo
        // sería regalarle la cuenta a cualquiera que escriba un CUIT ajeno.
        // Se invita, y la prueba sigue siendo el código al email registrado.
        <p className="mt-1 max-w-2xl text-sm text-text">
          Encontramos una cuenta con ese documento en nuestro sistema. Vinculala
          para ver <span className="font-medium">tus precios</span> y todas tus
          facturas.
        </p>
      ) : (
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Estás comprando a{" "}
          <span className="font-medium text-text">precio de lista general</span>.
          Si ya comprás en el local, vinculá tu cuenta para ver tus precios, tus
          facturas y —si tenés cuenta corriente— tu saldo.
        </p>
      )}

      <Link href="/mi-cuenta/vincular" className="mt-4 inline-block">
        <Button>Ya soy cliente del local</Button>
      </Link>
    </div>
  );
}

function Dato({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-text">{value}</dd>
    </div>
  );
}

/* ── Tab: Direcciones ──────────────────────────────────── */

interface Direccion {
  id: string;
  etiqueta: string;
  calle: string;
  ciudad: string;
  cp: string;
  referencia: string;
  principal: boolean;
}

const EMPTY_FORM: Omit<Direccion, "id" | "principal"> = {
  etiqueta: "",
  calle: "",
  ciudad: "",
  cp: "",
  referencia: "",
};

function DireccionesTab() {
  const [direcciones, setDirecciones] = useState<Direccion[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [direccionConfirmada, setDireccionConfirmada] = useState(false);
  /**
   * El usuario eligió cargar la dirección a mano. Va aparte de
   * `direccionConfirmada` porque cambia una regla: en modo automático, seguir
   * escribiendo la calle esconde los campos derivados; en modo manual eso
   * sería absurdo, porque pidió completarlos él.
   */
  const [modoManual, setModoManual] = useState(false);

  const canSave = form.etiqueta.trim() && form.calle.trim() && form.ciudad && direccionConfirmada;

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function guardar() {
    if (!canSave) return;
    setDirecciones((prev) => [
      ...prev,
      { ...form, id: crypto.randomUUID(), principal: prev.length === 0 },
    ]);
    setForm(EMPTY_FORM);
    setDireccionConfirmada(false);
    setModoManual(false);
    setShowForm(false);
  }

  function eliminar(id: string) {
    setDirecciones((prev) => {
      const next = prev.filter((d) => d.id !== id);
      if (next.length && !next.some((d) => d.principal)) next[0].principal = true;
      return [...next];
    });
  }

  function marcarPrincipal(id: string) {
    setDirecciones((prev) => prev.map((d) => ({ ...d, principal: d.id === id })));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-text">Direcciones de envío</h2>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-accent hover:text-white"
          >
            + Agregar dirección
          </button>
        )}
      </div>

      {/* Lista */}
      {direcciones.length === 0 && !showForm && (
        <div className="rounded-xl border border-border bg-surface p-6">
          <p className="text-sm text-muted">Todavía no cargaste direcciones de envío.</p>
        </div>
      )}

      {direcciones.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {direcciones.map((d) => (
            <div key={d.id} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-text">{d.etiqueta}</span>
                {d.principal && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                    Principal
                  </span>
                )}
              </div>
              <p className="text-sm text-text">{d.calle}</p>
              <p className="text-sm text-muted">{d.ciudad} · CP {d.cp || "—"}</p>

              {d.referencia && <p className="text-xs text-muted">{d.referencia}</p>}
              <div className="mt-2 flex gap-4 text-xs font-semibold">
                {!d.principal && (
                  <button onClick={() => marcarPrincipal(d.id)} className="text-primary hover:underline">
                    Marcar como principal
                  </button>
                )}
                <button onClick={() => eliminar(d.id)} className="text-danger hover:underline">
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Formulario */}
      {showForm && (
        <div className="rounded-xl border border-border bg-surface p-6">
          <h3 className="mb-4 text-sm font-bold text-text">Nueva dirección</h3>

          {/* Aviso de envíos */}
          <div className="mb-4 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <span className="mt-0.5 shrink-0 text-amber-500">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </span>
            <p className="text-xs leading-relaxed text-amber-800">
              <span className="font-semibold">Envíos sin cargo a El Dorado y Puerto Iguazú</span> en compras superiores a $100.000.
              Para otras localidades, el envío se coordina por separado.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            {/* 1. Calle con autocomplete — siempre visible primero */}
            <DireccionAutocomplete
              label="Calle y número"
              value={form.calle}
              onChange={(v) => {
                setField("calle", v);
                // Volver a escribir invalida la dirección confirmada y esconde
                // el resto... salvo en modo manual, donde el usuario ya dijo
                // que lo completa él.
                if (!modoManual) setDireccionConfirmada(false);
              }}
              onSeleccionar={(s) => {
                setForm((prev) => ({
                  ...prev,
                  calle: s.calle,
                  ciudad: s.ciudad || prev.ciudad,
                  cp: s.cp || prev.cp,
                }));
                setModoManual(false);
                setDireccionConfirmada(true);
              }}
              onCargarAMano={() => {
                setModoManual(true);
                setDireccionConfirmada(true);
              }}
              suspendido={modoManual}
              placeholder="Escribí la calle para buscar…"
            />

            {/*
              Escape a mano. Nominatim no tiene todas las calles de Iguazú
              cargadas, así que sin esta salida alguien puede quedar sin poder
              guardar su dirección de envío. Un autocompletado no puede ser la
              única forma de entrar un dato obligatorio.
            */}
            {!direccionConfirmada && form.calle.trim().length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setModoManual(true);
                  setDireccionConfirmada(true);
                }}
                className="self-start text-sm text-primary hover:underline"
              >
                No encuentro mi dirección — cargarla a mano
              </button>
            )}

            {/* 2. Resto del formulario — solo aparece al confirmar dirección */}
            {direccionConfirmada && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Ciudad">
                  <Input
                    value={form.ciudad}
                    onChange={(e) => setField("ciudad", e.target.value)}
                    placeholder="Ciudad"
                  />
                </Field>
                <Field label="Código postal">
                  <Input
                    value={form.cp}
                    onChange={(e) => setField("cp", e.target.value)}
                    placeholder="3380"
                  />
                </Field>
                <Field label="Etiqueta">
                  <Input
                    value={form.etiqueta}
                    onChange={(e) => setField("etiqueta", e.target.value)}
                    placeholder="Ej: Local, Depósito"
                  />
                </Field>
                <Field label="Referencia (opcional)">
                  <Input
                    value={form.referencia}
                    onChange={(e) => setField("referencia", e.target.value)}
                    placeholder="Entre calles, color de portón…"
                  />
                </Field>
              </div>
            )}
          </div>
          <div className="mt-5 flex gap-3">
            <Button onClick={guardar} disabled={!canSave}>Guardar dirección</Button>
            <button
              onClick={() => { setShowForm(false); setForm(EMPTY_FORM); setDireccionConfirmada(false); setModoManual(false); }}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-text transition-colors hover:bg-elevated"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
