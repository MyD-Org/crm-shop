"use client"

import { useState } from "react"
import { Card, Tabs } from "@myd-org/ui"
import type { EscalonDto, ProveedorDto } from "@/lib/cuotas-repo"
import type { SucursalDto, ZonaDto } from "@/lib/sucursales-repo"
import type { TasasMP } from "@/lib/mp-tasas"
import { CatalogManager } from "./CatalogManager"
import { CuotasTab } from "./CuotasTab"
import { ReceiptsEmailForm } from "./ReceiptsEmailForm"
import { ScheduleForm, type Schedule } from "./ScheduleForm"
import { SucursalesTab } from "./SucursalesTab"

type PriceColumn = { key: string; label: string }

type PriceList = {
  id: string
  tenantId: string
  name: string
  category: string
  priceColumns: PriceColumn[]
  fileName: string | null
  active: boolean
  uploadedAt: string
  createdAt: string
  itemCount: number
}

type PaymentCondition = { method: string; description: string }

interface Props {
  // `false` para admins: se oculta el tab Catálogo (superadmin-only) y arranca en Horarios.
  showCatalog: boolean
  // `false` para operator (la página hace notFound antes, pero el tab también se gatea acá).
  showReceipts: boolean
  // Medios de pago / Cuotas: admin+ (operator no lo ve; las APIs igual lo rechazan).
  showCuotas: boolean
  // Sucursales y ventas: admin+ (las APIs aceptan operador+, pero la pantalla vive en Configuración).
  showSucursales: boolean
  initialLists: PriceList[]
  initialPaymentConditions: PaymentCondition[]
  initialSchedule: Schedule
  initialReceiptsEmail: string
  initialProveedores: ProveedorDto[]
  initialEscalones: EscalonDto[]
  initialSucursales: SucursalDto[]
  initialZonas: ZonaDto[]
  tasasMP: TasasMP
}

type Tab = "catalogo" | "comprobantes" | "cuotas" | "sucursales" | "horarios"

export function ConfiguracionShell({
  showCatalog,
  showReceipts,
  showCuotas,
  showSucursales,
  initialLists,
  initialPaymentConditions,
  initialSchedule,
  initialReceiptsEmail,
  initialProveedores,
  initialEscalones,
  initialSucursales,
  initialZonas,
  tasasMP,
}: Props) {
  const [tab, setTab] = useState<Tab>(showCatalog ? "catalogo" : "horarios")

  const items = [
    ...(showCatalog ? [{ value: "catalogo", label: "Catálogo" }] : []),
    ...(showReceipts ? [{ value: "comprobantes", label: "Comprobantes" }] : []),
    ...(showCuotas ? [{ value: "cuotas", label: "Medios de pago / Cuotas" }] : []),
    ...(showSucursales ? [{ value: "sucursales", label: "Sucursales y ventas" }] : []),
    { value: "horarios", label: "Horarios" },
  ]

  return (
    <div className="flex flex-col gap-4">
      <Tabs variant="underline" value={tab} onValueChange={(v) => setTab(v as Tab)} items={items} />

      {tab === "catalogo" && showCatalog && (
        <CatalogManager initialLists={initialLists} initialPaymentConditions={initialPaymentConditions} />
      )}
      {tab === "comprobantes" && showReceipts && (
        <Card
          title="Comprobantes de pago"
          description="Los clientes pueden informar un pago desde el portal (Pagos → Informar pago) adjuntando el comprobante."
        >
          <ReceiptsEmailForm initialReceiptsEmail={initialReceiptsEmail} />
        </Card>
      )}
      {tab === "cuotas" && showCuotas && <CuotasTab initialProveedores={initialProveedores} initialEscalones={initialEscalones} tasasMP={tasasMP} />}
      {tab === "sucursales" && showSucursales && (
        <SucursalesTab initialSucursales={initialSucursales} initialZonas={initialZonas} />
      )}
      {tab === "horarios" && <ScheduleForm initialSchedule={initialSchedule} />}
    </div>
  )
}
