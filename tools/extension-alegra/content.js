// Alegra: columnas de la grilla de ítems — content script.
//
// En presupuestos y remitos de Alegra permite:
//   - sumar columnas calculadas (Subtotal c/IVA, Precio c/IVA);
//   - ocultar columnas de Alegra;
//   - cambiar el orden de las columnas.
// Solo LEE la pantalla: no toca inputs ni envía nada. La config viene del popup (config.js).
//
// La grilla es Vue: un único contenedor `.dui-items-group-table__table` con display:grid y
// todas las celdas planas (header + N celdas por fila). Para no pelearnos con Vue:
//   - NUNCA movemos ni borramos nodos de Vue; solo les ponemos atributos data-civa-c (columna)
//     y data-civa-r (fila), y una hoja de estilo propia ubica cada celda con grid-column /
//     grid-row explícitos (!important). Así el orden visual cambia sin tocar el DOM de Vue.
//   - Las celdas calculadas son nodos nuestros, agregados como hermanos.
// Si la estructura no es la esperada, la tabla queda exactamente como la dibuja Alegra.
// Limitación conocida: el orden de Tab sigue el orden original de Alegra.

/* global CIVA_CONFIG */
;(() => {
  "use strict"

  const TABLA = ".dui-items-group-table__table"
  const ATTR_TABLA = "data-civa"
  const ATTR_COL = "data-civa-c"
  const ATTR_FILA = "data-civa-r"
  const CLASE_PROPIA = "civa-propia"

  const style = document.createElement("style")
  style.id = "civa-style"

  let cfg = null

  /** ancla nativa → Map(idExtra → nodo nuestro) */
  const propiasDe = new WeakMap()

  const esPropia = (el) => el.classList.contains(CLASE_PROPIA)
  const esHeader = (el) =>
    el.classList.contains("dui-items-table-header-cell") || el.classList.contains("dui-items-group-table__drag-header")
  const esInicioFila = (el) => el.classList.contains("dui-items-group-table__drag-cell")

  // ── Números ──────────────────────────────────────────────────────────────

  /** "$3,229.76" | "$ 3.229,76" | "3229.76" → { valor, decimal, prefijo } o null */
  function parseMonto(texto) {
    const t = (texto || "").trim()
    const iDigito = t.search(/\d/)
    if (iDigito < 0) return null
    const prefijo = t.slice(0, iDigito).replace(/-/g, "").trim()
    const negativo = t.slice(0, iDigito).includes("-")
    const num = t.slice(iDigito).replace(/[^\d.,]/g, "")
    const iSep = Math.max(num.lastIndexOf("."), num.lastIndexOf(","))
    let decimal = null
    let valor
    if (iSep >= 0 && /^\d{1,2}$/.test(num.slice(iSep + 1))) {
      decimal = num[iSep]
      valor = Number(num.slice(0, iSep).replace(/[.,]/g, "") + "." + num.slice(iSep + 1))
    } else {
      valor = Number(num.replace(/[.,]/g, "")) // el separador que haya es de miles
      if (iSep >= 0) decimal = num[iSep] === "," ? "." : ","
    }
    if (!Number.isFinite(valor)) return null
    return { valor: negativo ? -valor : valor, decimal, prefijo }
  }

  function formatMonto(valor, decimal, prefijo) {
    const locale = decimal === "," ? "es-AR" : "en-US"
    const txt = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      Math.abs(valor),
    )
    return (valor < 0 ? "-" : "") + (prefijo || "$") + txt
  }

  /** "IVA - (21.00%)" → 21 ; "Ninguno" / "" → 0 ; texto sin % (p. ej. "2 impuestos") → null */
  function tasaImpuesto(texto) {
    const t = (texto || "").trim()
    if (!t || /^ningun/i.test(t)) return 0
    const tasas = [...t.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map((m) => Number(m[1].replace(",", ".")))
    if (!tasas.length) return null
    return tasas.reduce((a, b) => a + b, 0)
  }

  const textoCelda = (celda) => {
    if (!celda) return ""
    const input = celda.querySelector("input")
    return (input && input.value) || celda.textContent || ""
  }

  const redondear = (n) => Math.round(n * 100) / 100

  /** Valor de una columna calculada para una fila: { texto, ayuda } */
  function calcular(id, fila, idx) {
    const sub = parseMonto(textoCelda(fila[idx.sub]))
    const tasa = idx.imp >= 0 ? tasaImpuesto(textoCelda(fila[idx.imp])) : null
    if (tasa == null) return { texto: "—", ayuda: "No se pudo leer la tasa del impuesto de la línea" }
    const decimal = (sub && sub.decimal) || "."
    const prefijo = (sub && sub.prefijo) || "$"
    if (id === "x:subtotalIva") {
      if (!sub) return { texto: "—", ayuda: "No se pudo leer el subtotal de la línea" }
      return { texto: formatMonto(redondear(sub.valor * (1 + tasa / 100)), decimal, prefijo), ayuda: `Subtotal + ${tasa}%` }
    }
    if (id === "x:precioIva") {
      const precio = idx.precio >= 0 ? parseMonto(textoCelda(fila[idx.precio])) : null
      if (!precio) return { texto: formatMonto(0, decimal, prefijo), ayuda: "Línea sin precio" }
      return { texto: formatMonto(redondear(precio.valor * (1 + tasa / 100)), decimal, prefijo), ayuda: `Precio + ${tasa}%` }
    }
    return { texto: "", ayuda: "" }
  }

  // ── Columnas ─────────────────────────────────────────────────────────────

  /** separa "20px 44px minmax(0, 1fr) 7%" respetando paréntesis */
  function tokens(template) {
    const out = []
    let prof = 0
    let actual = ""
    for (const ch of (template || "").trim()) {
      if (ch === "(") prof++
      if (ch === ")") prof--
      if (/\s/.test(ch) && prof === 0) {
        if (actual) out.push(actual)
        actual = ""
      } else actual += ch
    }
    if (actual) out.push(actual)
    return out
  }

  const pct = (t) => (/^[\d.]+%$/.test(t) ? Number(t.slice(0, -1)) : null)

  // ── Nodos propios ────────────────────────────────────────────────────────

  /** copia class y los data-v-* (estilos scoped de Vue) del ancla, sin data-test ni keys de drag */
  function clonarAtributos(desde, hacia) {
    for (const a of desde.attributes) {
      if (a.name === "class" || a.name.startsWith("data-v-")) hacia.setAttribute(a.name, a.value)
    }
  }

  function propia(ancla, id, esCabecera, modeloP) {
    let mapa = propiasDe.get(ancla)
    if (!mapa) propiasDe.set(ancla, (mapa = new Map()))
    let el = mapa.get(id)
    if (!el) {
      el = document.createElement("div")
      clonarAtributos(ancla, el)
      el.classList.add(CLASE_PROPIA)
      if (esCabecera) {
        el.classList.add("justify-end")
        el.textContent = CIVA_CONFIG.titulo(id)
        el.title = CIVA_CONFIG.EXTRAS[id].ayuda + " (agregado por la extensión)"
      } else {
        const p = document.createElement("p")
        p.className = (modeloP && modeloP.className) || "text-right text-sm leading-8 mt-1"
        p.style.fontWeight = "600"
        el.appendChild(p)
      }
      mapa.set(id, el)
    }
    return el
  }

  function setTexto(el, texto, ayuda) {
    const p = el.firstElementChild || el
    if (p.textContent !== texto) p.textContent = texto
    if (el.title !== ayuda) el.title = ayuda
  }

  function setAttr(el, nombre, valor) {
    if (el.getAttribute(nombre) !== valor) el.setAttribute(nombre, valor)
  }

  // ── Sincronización ───────────────────────────────────────────────────────

  function limpiarTabla(tabla) {
    for (const el of [...tabla.children]) {
      if (esPropia(el)) el.remove()
      else {
        el.removeAttribute(ATTR_COL)
        el.removeAttribute(ATTR_FILA)
      }
    }
    tabla.removeAttribute(ATTR_TABLA)
  }

  function limpiar() {
    document.querySelectorAll(`[${ATTR_TABLA}]`).forEach(limpiarTabla)
    document.querySelectorAll(`.${CLASE_PROPIA}`).forEach((el) => el.remove())
    if (style.isConnected) style.remove()
  }

  /** Arma la grilla de una tabla según la config. Devuelve el CSS o null (tabla sin tocar). */
  function sincronizarTabla(tabla, nTabla) {
    const nativos = [...tabla.children].filter((el) => !esPropia(el))
    const headers = []
    for (const el of nativos) {
      if (!esHeader(el)) break
      headers.push(el)
    }
    const n = headers.length
    const cols = tokens(tabla.style.gridTemplateColumns)
    if (n === 0 || cols.length !== n) return null
    const etiquetas = headers.map((h) => h.textContent.trim())
    const idx = {
      sub: etiquetas.indexOf("Subtotal"),
      imp: etiquetas.indexOf("Impuesto"),
      precio: etiquetas.indexOf("Precio"),
    }

    // filas: grupos de n celdas que empiezan con la celda de arrastre; el resto (botón
    // «Agregar línea», etc.) va a filas propias de ancho completo
    const filas = []
    const sueltos = []
    for (let i = n; i < nativos.length; ) {
      if (esInicioFila(nativos[i]) && i + n <= nativos.length) {
        const fila = nativos.slice(i, i + n)
        if (fila.slice(1).some(esInicioFila)) return null // fila incompleta: estructura desconocida
        filas.push(fila)
        i += n
      } else sueltos.push(nativos[i++])
    }

    // columnas fijas de Alegra: sin título a la izquierda (arrastre, checkbox) y a la derecha (menú)
    let izq = 0
    while (izq < n && !etiquetas[izq]) izq++
    let der = n
    while (der > izq && !etiquetas[der - 1]) der--

    // orden final: fijas izq + config (visibles y presentes) + nativas desconocidas + fijas der
    const final = []
    for (let i = 0; i < izq; i++) final.push({ nat: i })
    const usadas = new Set()
    for (const c of cfg.columnas) {
      if (c.id.startsWith("x:")) {
        if (c.visible && CIVA_CONFIG.EXTRAS[c.id]) final.push({ x: c.id })
        continue
      }
      const i = etiquetas.indexOf(c.id.slice(2))
      if (i < izq || i >= der) continue
      usadas.add(i)
      if (c.visible) final.push({ nat: i })
    }
    for (let i = izq; i < der; i++) if (!usadas.has(i)) final.push({ nat: i })
    for (let i = der; i < n; i++) final.push({ nat: i })

    const sinCambios = final.length === n && final.every((f, k) => f.nat === k)
    if (sinCambios) return null

    // anchos: las columnas en % se reescalan para ocupar el mismo % total que antes
    const pctOriginal = cols.reduce((a, t) => a + (pct(t) ?? 0), 0)
    const tracks = final.map((f) => (f.x ? CIVA_CONFIG.EXTRAS[f.x].ancho + "%" : cols[f.nat]))
    const pctNuevo = tracks.reduce((a, t) => a + (pct(t) ?? 0), 0)
    const factor = pctNuevo > 0 && pctOriginal > 0 ? pctOriginal / pctNuevo : 1
    const template = tracks.map((t) => (pct(t) == null ? t : (pct(t) * factor).toFixed(2) + "%")).join(" ")

    const posNat = new Map(final.map((f, k) => [f.nat, k + 1]).filter(([i]) => i !== undefined))
    const extras = final.map((f, k) => [f.x, k + 1]).filter(([x]) => x)
    const deseadas = new Set()

    const ubicarGrupo = (grupo, fila, esCabecera) => {
      grupo.forEach((el, i) => {
        setAttr(el, ATTR_COL, String(posNat.get(i) || 0))
        setAttr(el, ATTR_FILA, String(fila))
      })
      let previo = grupo[n - 1]
      for (const [id, pos] of extras) {
        const el = propia(grupo[n - 1], id, esCabecera, idx.sub >= 0 ? grupo[idx.sub].querySelector("p") : null)
        if (previo.nextElementSibling !== el) previo.after(el)
        previo = el
        setAttr(el, ATTR_COL, String(pos))
        setAttr(el, ATTR_FILA, String(fila))
        deseadas.add(el)
        if (!esCabecera) {
          const { texto, ayuda } = idx.sub >= 0 ? calcular(id, grupo, idx) : { texto: "—", ayuda: "Sin columna Subtotal" }
          setTexto(el, texto, ayuda)
        }
      }
    }

    ubicarGrupo(headers, 1, true)
    filas.forEach((fila, k) => ubicarGrupo(fila, k + 2, false))
    sueltos.forEach((el, k) => {
      setAttr(el, ATTR_COL, "full")
      setAttr(el, ATTR_FILA, String(filas.length + 2 + k))
    })
    for (const el of [...tabla.children]) if (esPropia(el) && !deseadas.has(el)) el.remove()

    setAttr(tabla, ATTR_TABLA, String(nTabla))
    const T = `${TABLA}[${ATTR_TABLA}="${nTabla}"]`
    const reglas = [
      `${T}{grid-template-columns:${template} !important;grid-auto-flow:row !important}`,
      `${T}>[${ATTR_COL}="0"]{display:none !important}`,
      `${T}>[${ATTR_COL}="full"]{grid-column:1 / -1 !important}`,
    ]
    for (let k = 1; k <= final.length; k++) reglas.push(`${T}>[${ATTR_COL}="${k}"]{grid-column:${k} !important}`)
    const totalFilas = filas.length + 1 + sueltos.length
    for (let r = 1; r <= totalFilas; r++) reglas.push(`${T}>[${ATTR_FILA}="${r}"]{grid-row:${r} !important}`)
    return reglas.join("\n")
  }

  function docActual() {
    for (const [clave, doc] of Object.entries(CIVA_CONFIG.DOCS)) {
      if (new RegExp(doc.ruta).test(location.pathname)) return clave
    }
    return null
  }

  let corriendo = false
  function sincronizar() {
    if (corriendo || !cfg) return
    corriendo = true
    try {
      const doc = docActual()
      if (!doc || !cfg.docs[doc]) return limpiar()
      const reglas = []
      document.querySelectorAll(TABLA).forEach((tabla, k) => {
        const css = sincronizarTabla(tabla, k)
        if (css) reglas.push(css)
        else limpiarTabla(tabla) // config sin cambios o estructura inesperada: grilla original
      })
      const css = reglas.join("\n")
      if (style.textContent !== css) style.textContent = css
      if (!style.isConnected) document.head.appendChild(style)
    } catch (err) {
      console.warn("[Alegra columnas]", err)
      limpiar()
    } finally {
      corriendo = false
    }
  }

  async function cargarConfig() {
    try {
      cfg = await CIVA_CONFIG.leer()
    } catch (err) {
      console.warn("[Alegra columnas] no se pudo leer la configuración", err)
      cfg = CIVA_CONFIG.normalizar(null)
    }
    sincronizar()
  }

  chrome.storage.onChanged.addListener((cambios, area) => {
    if (area === "sync" && cambios.config) cargarConfig()
  })
  new MutationObserver(sincronizar).observe(document.body, { childList: true, subtree: true, characterData: true })
  // Inputs y el select de impuesto cambian .value (propiedad, no DOM): no disparan el observer.
  for (const ev of ["input", "change", "click", "keyup"]) {
    document.addEventListener(ev, () => setTimeout(sincronizar, 60), true)
  }
  setInterval(sincronizar, 1000)
  cargarConfig()
})()
