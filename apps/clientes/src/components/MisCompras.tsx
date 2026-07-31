"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Button, Field, Input } from "@myd-org/ui";
import { ORDERS, ORDER_SUMMARY, ORDER_ESTADO_LABEL, type Order, type OrderEstado } from "@/data/orders";

const CRM_URL = process.env.NEXT_PUBLIC_CRM_URL ?? "https://crm.cliente.example";

function fmt(n: number) {
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0 });
}

function fmtFecha(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" });
}

const ESTADO_COLOR: Record<OrderEstado, string> = {
  entregado: "#16a34a",
  en_camino: "#2563eb",
  preparacion: "#d97706",
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
  const total = order.items.reduce((acc, i) => acc + i.price * i.qty, 0);
  const unidades = order.items.reduce((acc, i) => acc + i.qty, 0);
  const esEnvio = order.metodoEntrega.toLowerCase().includes("env");

  return (
    <div className="rounded-xl border border-border bg-surface">
      {/* Cabecera */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <div className="flex flex-col">
          <span className="text-sm font-bold text-text">Pedido {order.numero}</span>
          <span className="text-xs text-muted">{fmtFecha(order.fecha)}</span>
        </div>
        <EstadoPill estado={order.estado} />
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
            <p className="shrink-0 text-sm font-semibold text-text">{fmt(item.price * item.qty)}</p>
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
          <span className="font-extrabold">{fmt(total)}</span>
        </span>
      </div>

      {/* Acciones */}
      <div className="flex flex-wrap items-center gap-3 px-5 py-3.5">
        <Link href={`/mi-cuenta/pedido/${order.id}`}>
          <button className="flex items-center gap-2 rounded-lg bg-[#0a1f44] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary">
            Ver detalle <ArrowRightIcon />
          </button>
        </Link>
        <button className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-elevated">
          <RefreshIcon />
          Volver a comprar
        </button>
        {esEnvio && (
          <button className="ml-auto flex items-center gap-2 text-sm font-medium text-muted transition-colors hover:text-text">
            <TruckIcon />
            Seguir envío
          </button>
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
}: {
  nombre: string;
  cuit?: string;
  email?: string;
  esCuentaCorriente: boolean;
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
            className="flex items-center gap-2 rounded-lg bg-[#0a1f44] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary"
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

      {tab === "compras" && (
        <ComprasTab nombre={nombre} esCuentaCorriente={esCuentaCorriente} />
      )}
      {tab === "datos" && <DatosTab nombre={nombre} cuit={cuit} email={email} />}
      {tab === "direcciones" && <DireccionesTab />}
    </div>
  );
}

/* ── Tab: Mis compras ──────────────────────────────────── */

function ComprasTab({ nombre, esCuentaCorriente }: { nombre: string; esCuentaCorriente: boolean }) {
  void nombre;
  return (
    <div className="flex flex-col gap-6">
      {/* Tarjetas resumen */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard label="Pedidos este año" value={String(ORDER_SUMMARY.pedidosEsteAnio)} />
        <SummaryCard label="En curso" value={`${ORDER_SUMMARY.enCurso} pedido${ORDER_SUMMARY.enCurso === 1 ? "" : "s"}`} />
        <SummaryCard label="Comprado este año" value={fmt(ORDER_SUMMARY.compradoEsteAnio)} />
      </div>

      {/* Lista de pedidos */}
      {ORDERS.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface py-16 text-center">
          <p className="text-lg font-bold text-text">Todavía no hiciste compras</p>
          <Link href="/catalogo">
            <Button>Ver catálogo</Button>
          </Link>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-4">
            {ORDERS.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
          <div className="flex justify-center pt-2">
            <button className="rounded-lg border border-border bg-surface px-6 py-2.5 text-sm font-semibold text-text transition-colors hover:bg-elevated">
              Ver pedidos anteriores
            </button>
          </div>
        </>
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

function DatosTab({ nombre, cuit, email }: { nombre: string; cuit?: string; email?: string }) {
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState({ razonsocial: nombre, email: email ?? "" });
  const [guardando, setGuardando] = useState(false);
  const [exito, setExito] = useState(false);
  const [error, setError] = useState("");

  async function guardar() {
    setGuardando(true);
    setError("");
    try {
      const res = await fetch("/api/mi-cuenta/datos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      setExito(true);
      setEditando(false);
      setTimeout(() => setExito(false), 3000);
    } catch {
      setError("No se pudieron guardar los cambios. Intentá de nuevo.");
    } finally {
      setGuardando(false);
    }
  }

  function cancelar() {
    setForm({ razonsocial: nombre, email: email ?? "" });
    setEditando(false);
    setError("");
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold text-text">Datos de la cuenta</h2>
        {!editando && (
          <button
            onClick={() => setEditando(true)}
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-text transition-colors hover:bg-elevated"
          >
            Editar
          </button>
        )}
      </div>

      {exito && (
        <div className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
          Datos actualizados correctamente.
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      {editando ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Razón social">
              <Input
                value={form.razonsocial}
                onChange={(e) => setForm((f) => ({ ...f, razonsocial: e.target.value }))}
                placeholder="Razón social"
              />
            </Field>
            <div>
              <dt className="mb-1.5 text-xs uppercase tracking-wide text-muted">CUIT</dt>
              <dd className="rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-muted">
                {cuit ?? "—"}
              </dd>
            </div>
            <Field label="Email">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="correo@ejemplo.com"
              />
            </Field>
          </div>
          <div className="flex gap-3 pt-1">
            <Button onClick={guardar} disabled={guardando || !form.razonsocial.trim()}>
              {guardando ? "Guardando…" : "Guardar cambios"}
            </Button>
            <button
              onClick={cancelar}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-text transition-colors hover:bg-elevated"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Dato label="Razón social" value={form.razonsocial || nombre} />
          <Dato label="CUIT" value={cuit ?? "—"} />
          <Dato label="Email" value={form.email || (email ?? "—")} />
        </dl>
      )}
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

interface Sugerencia { label: string; calle: string; ciudad: string; cp: string }

function DireccionesTab() {
  const [direcciones, setDirecciones] = useState<Direccion[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [direccionConfirmada, setDireccionConfirmada] = useState(false);
  const [sugerencias, setSugerencias] = useState<Sugerencia[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [indice, setIndice] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const canSave = form.etiqueta.trim() && form.calle.trim() && form.ciudad && direccionConfirmada;

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function onCalleChange(value: string) {
    setField("calle", value);
    setDireccionConfirmada(false);
    setIndice(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.length < 3) { setSugerencias([]); setAbierto(false); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode?text=${encodeURIComponent(value)}`);
        if (res.ok) {
          const data = await res.json();
          setSugerencias(data);
          setAbierto(data.length > 0);
        }
      } catch { /* silencioso */ }
    }, 300);
  }

  function seleccionarSugerencia(s: Sugerencia) {
    setForm((prev) => ({ ...prev, calle: s.calle, ciudad: s.ciudad, cp: s.cp }));
    setSugerencias([]);
    setAbierto(false);
    setIndice(-1);
    setDireccionConfirmada(true);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!abierto || sugerencias.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndice((i) => Math.min(i + 1, sugerencias.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndice((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && indice >= 0) {
      e.preventDefault();
      seleccionarSugerencia(sugerencias[indice]);
    } else if (e.key === "Escape") {
      setAbierto(false);
      setIndice(-1);
    }
  }

  function guardar() {
    if (!canSave) return;
    setDirecciones((prev) => [
      ...prev,
      { ...form, id: crypto.randomUUID(), principal: prev.length === 0 },
    ]);
    setForm(EMPTY_FORM);
    setSugerencias([]);
    setDireccionConfirmada(false);
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
            className="rounded-lg bg-[#0a1f44] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary"
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
            <div className="relative">
              <Field label="Calle y número">
                <Input
                  ref={inputRef}
                  value={form.calle}
                  onChange={(e) => onCalleChange(e.target.value)}
                  onKeyDown={onKeyDown}
                  onBlur={() => setTimeout(() => setAbierto(false), 150)}
                  onFocus={() => sugerencias.length > 0 && setAbierto(true)}
                  placeholder="Escribí la calle para buscar…"
                  autoComplete="off"
                />
              </Field>
              {abierto && sugerencias.length > 0 && (
                <ul className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
                  {sugerencias.map((s, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onMouseDown={() => seleccionarSugerencia(s)}
                        className={`w-full px-4 py-2.5 text-left text-sm transition-colors ${
                          i === indice ? "bg-elevated text-primary" : "text-text hover:bg-elevated"
                        }`}
                      >
                        {s.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

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
              onClick={() => { setShowForm(false); setForm(EMPTY_FORM); setSugerencias([]); setDireccionConfirmada(false); }}
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
