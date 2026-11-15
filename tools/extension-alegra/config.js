// Configuración compartida entre el content script y el popup.
// Se guarda en chrome.storage.sync (viaja con la cuenta de Chrome del usuario).

// eslint-disable-next-line no-unused-vars
var CIVA_CONFIG = (() => {
  "use strict"

  /** Columnas calculadas por la extensión. `ancho` en % del ancho de la grilla. */
  const EXTRAS = {
    "x:subtotalIva": {
      titulo: "Subtotal c/IVA",
      ancho: 11,
      ayuda: "Subtotal de la línea (con descuento) más impuestos",
    },
    "x:precioIva": {
      titulo: "Precio c/IVA",
      ancho: 11,
      ayuda: "Precio unitario más impuestos, sin descuento",
    },
  }

  /** Columnas propias de Alegra, identificadas por el texto del encabezado. */
  const NATIVAS = ["Producto o servicios", "Cantidad", "Precio", "Descuento", "Impuesto", "Subtotal"]
  const OBLIGATORIAS = ["n:Producto o servicios"]

  /** Pantallas con la grilla nueva de ítems. Facturas de venta usa otra pantalla: no aplica. */
  const DOCS = {
    estimate: { titulo: "Presupuestos", ruta: "^/estimate(/|$)" },
    remission: { titulo: "Remitos", ruta: "^/remission(/|$)" },
  }

  const POR_DEFECTO = {
    docs: { estimate: true, remission: false },
    columnas: [
      ...NATIVAS.map((n) => ({ id: "n:" + n, visible: true })),
      { id: "x:subtotalIva", visible: true },
      { id: "x:precioIva", visible: false },
    ],
  }

  const titulo = (id) => (id.startsWith("x:") ? (EXTRAS[id] ? EXTRAS[id].titulo : id) : id.slice(2))

  /** Completa una config guardada (quizás vieja o parcial) con los valores por defecto. */
  function normalizar(cfg) {
    const base = JSON.parse(JSON.stringify(POR_DEFECTO))
    if (!cfg || typeof cfg !== "object") return base
    const docs = { ...base.docs }
    for (const k of Object.keys(docs)) if (cfg.docs && typeof cfg.docs[k] === "boolean") docs[k] = cfg.docs[k]
    const conocidas = new Set(base.columnas.map((c) => c.id))
    const vistas = new Set()
    const columnas = []
    for (const c of Array.isArray(cfg.columnas) ? cfg.columnas : []) {
      if (!c || !conocidas.has(c.id) || vistas.has(c.id)) continue
      vistas.add(c.id)
      columnas.push({ id: c.id, visible: OBLIGATORIAS.includes(c.id) || c.visible !== false })
    }
    for (const c of base.columnas) if (!vistas.has(c.id)) columnas.push(c)
    return { docs, columnas }
  }

  async function leer() {
    const { config } = await chrome.storage.sync.get("config")
    return normalizar(config)
  }

  function guardar(cfg) {
    return chrome.storage.sync.set({ config: normalizar(cfg) })
  }

  return { EXTRAS, NATIVAS, OBLIGATORIAS, DOCS, POR_DEFECTO, titulo, normalizar, leer, guardar }
})()
