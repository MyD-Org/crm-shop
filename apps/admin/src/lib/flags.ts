import { flag } from "@vercel/flags/next"
import { flag as flagVercel } from "flags/next"
import { vercelAdapter } from "@flags-sdk/vercel"

// ── Feature flags ──────────────────────────────────────────────────────────
// Proveedor actual: Vercel Flags
// Para cambiar de proveedor: reemplazar solo este archivo manteniendo la misma
// interfaz exportada (cada flag es una función async que devuelve boolean).

export const shopEnabled = flag<boolean>({
  key: "shop-enabled",
  defaultValue: false,
  description: "Activa el link a la tienda online en el header del portal",
  origin: "https://vercel.com/docs/workflow-collaboration/feature-flags",
  decide: () => process.env.SHOP_ENABLED === "true",
})

export const aiChatEnabled = flag<boolean>({
  key: "ai-chat-enabled",
  defaultValue: false,
  description: "Muestra la burbuja de chat con el agente de soporte post-venta",
  origin: "https://vercel.com/docs/workflow-collaboration/feature-flags",
  // Hasta conectar el adapter de Vercel: se controla por env (true en dev local)
  decide: () => process.env.AI_CHAT_ENABLED === "true",
})

// Panel de gasto del bot ("Uso del bot") en el admin. Apagado por default: la feature
// va a migrar al proyecto ia-dashboard; queda gateada en el CRM hasta entonces. Activar
// con BOT_USAGE_PANEL_ENABLED=true.
export const botUsagePanelEnabled = flag<boolean>({
  key: "bot-usage-panel-enabled",
  defaultValue: false,
  description: "Muestra el panel de gasto/uso del bot en el admin (migrará a ia-dashboard)",
  origin: "https://vercel.com/docs/workflow-collaboration/feature-flags",
  decide: () => process.env.BOT_USAGE_PANEL_ENABLED === "true",
})

// Correo compartido (Resend Inboxes) en el admin. Vive en Vercel Flags (key `correo`): se
// prende y apaga desde el dashboard o con `vercel flags enable correo --environment <env>`, sin
// redeploy. Falla hacia apagado. Nadie lo llama directo: ver lib/correo-flag.ts.
export const correoFlag = flagVercel<boolean>({
  key: "correo",
  description: "Correo compartido en el admin: webhook de recepción, menú, páginas y rutas de Correo",
  defaultValue: false,
  adapter: vercelAdapter,
})
