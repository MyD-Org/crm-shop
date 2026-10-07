/** Íconos y título compartidos por las pantallas de pago (Mercado Pago y Payway). */

const trazo = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function IconoTarjeta() {
  return (
    <svg {...trazo}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
      <path d="M6 15h4" />
    </svg>
  );
}

export function IconoTarjetaDebito() {
  return (
    <svg {...trazo}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M6 12h2" />
      <path d="M11 12h2" />
      <path d="M16 12h2" />
    </svg>
  );
}

export function IconoBilletera() {
  return (
    <svg {...trazo}>
      <path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" />
      <path d="M21 11h-5a2 2 0 0 0 0 4h5z" />
    </svg>
  );
}

export function IconoCandado() {
  return (
    <svg {...trazo} width={18} height={18} strokeWidth={2}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

/** Título visible de "¿Cómo quiere pagar?". El `RadioGroup` conserva la leyenda para lectores de pantalla. */
export function TituloComoPagar() {
  return (
    <h2 aria-hidden="true" className="text-lg font-bold text-text">
      ¿Cómo quiere pagar?
    </h2>
  );
}
