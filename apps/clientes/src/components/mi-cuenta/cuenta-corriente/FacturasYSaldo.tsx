"use client";

import { useRef, useState } from "react";
import { Alert } from "@myd-org/ui";
import type { Cuenta, Factura } from "@/lib/cuenta-corriente/tipos";
import type { DeepLinkFactura, DocumentoAbierto, FiltroEstado } from "@/lib/cuenta-corriente/vista-facturas";
import { SeccionTitulo } from "../SeccionTitulo";
import { AvisoSeccionCaida } from "./AvisoSeccionCaida";
import { FacturasSeccion } from "./FacturasSeccion";
import { SaldoTarjetas } from "./SaldoTarjetas";
import { VisorDocumento } from "./VisorDocumento";
import type { ContactoWhatsApp } from "./WhatsAppFacturas";

/**
 * "Facturas y saldo": tarjetas de saldo arriba (si `mostrarSaldo`), lista de facturas abajo y el
 * visor del PDF en un diálogo dentro de la página. Cada bloque que no se pudo
 * traer muestra su aviso y el otro sigue andando.
 */
export function FacturasYSaldo({
  cuenta,
  mostrarSaldo,
  mostrarLimite,
  primeraPagina,
  whatsapp,
  deepLink,
}: {
  /** `null` = el saldo no se pudo traer. */
  cuenta: Cuenta | null;
  /** `false` = cliente de contado sin deuda: el bloque Saldo no se muestra. */
  mostrarSaldo: boolean;
  mostrarLimite: boolean;
  /** `null` = las facturas no se pudieron traer. */
  primeraPagina: { facturas: Factura[]; total: number } | null;
  whatsapp: ContactoWhatsApp | null;
  deepLink: DeepLinkFactura;
}) {
  const [estado, setEstado] = useState<FiltroEstado>("todas");
  const [visor, setVisor] = useState<DocumentoAbierto | null>(deepLink && "abrir" in deepLink ? deepLink.abrir : null);
  const lista = useRef<HTMLElement>(null);

  function verFacturas(e: "vencida" | "pendiente") {
    setEstado(e);
    lista.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex flex-col gap-8">
      {deepLink && "noEncontrada" in deepLink && <Alert tone="warning">No encontramos la factura.</Alert>}

      {mostrarSaldo && (
        <section aria-labelledby="saldo-titulo">
          <SeccionTitulo id="saldo-titulo" titulo="Saldo" />
          {cuenta ? (
            <SaldoTarjetas cuenta={cuenta} mostrarLimite={mostrarLimite} onVerFacturas={verFacturas} />
          ) : (
            <AvisoSeccionCaida que="su saldo" />
          )}
        </section>
      )}

      <section ref={lista} aria-labelledby="facturas-titulo" className="scroll-mt-24">
        <SeccionTitulo id="facturas-titulo" titulo="Facturas" />
        {primeraPagina ? (
          <FacturasSeccion
            primeraPagina={primeraPagina}
            abiertas={cuenta?.abiertas ?? null}
            estado={estado}
            onEstado={setEstado}
            whatsapp={whatsapp}
            onVer={(f) => setVisor({ kind: "factura", alegraId: f.alegraId, titulo: `Factura ${f.id}` })}
          />
        ) : (
          <AvisoSeccionCaida que="sus facturas" />
        )}
      </section>

      <VisorDocumento doc={visor} onClose={() => setVisor(null)} />
    </div>
  );
}
