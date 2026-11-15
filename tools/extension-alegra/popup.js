/* global CIVA_CONFIG */
;(async () => {
  "use strict"

  const $docs = document.getElementById("docs")
  const $columnas = document.getElementById("columnas")
  const $estado = document.getElementById("estado")

  let cfg = await CIVA_CONFIG.leer()
  let timer = null

  async function guardar() {
    await CIVA_CONFIG.guardar(cfg)
    $estado.textContent = "Guardado"
    clearTimeout(timer)
    timer = setTimeout(() => ($estado.textContent = ""), 1200)
  }

  function check(texto, marcado, alCambiar, deshabilitado) {
    const input = document.createElement("input")
    input.type = "checkbox"
    input.checked = marcado
    input.disabled = !!deshabilitado
    input.addEventListener("change", () => alCambiar(input.checked))
    return input
  }

  function render() {
    $docs.replaceChildren(
      ...Object.entries(CIVA_CONFIG.DOCS).map(([clave, doc]) => {
        const label = document.createElement("label")
        label.className = "check"
        label.append(
          check(doc.titulo, !!cfg.docs[clave], (v) => {
            cfg.docs[clave] = v
            guardar()
          }),
          doc.titulo,
        )
        return label
      }),
    )

    $columnas.replaceChildren(
      ...cfg.columnas.map((col, i) => {
        const li = document.createElement("li")
        if (!col.visible) li.classList.add("oculta")
        const obligatoria = CIVA_CONFIG.OBLIGATORIAS.includes(col.id)

        const label = document.createElement("label")
        const nombre = document.createElement("span")
        nombre.className = "nombre"
        nombre.textContent = CIVA_CONFIG.titulo(col.id)
        label.append(
          check(
            nombre.textContent,
            col.visible,
            (v) => {
              col.visible = v
              guardar()
              render()
            },
            obligatoria,
          ),
          nombre,
        )
        if (col.id.startsWith("x:")) {
          const tag = document.createElement("span")
          tag.className = "tag"
          tag.textContent = "calculada"
          label.title = CIVA_CONFIG.EXTRAS[col.id].ayuda
          label.append(tag)
        } else if (obligatoria) {
          label.title = "Esta columna no se puede ocultar"
        }

        const mover = (delta, simbolo, ayuda) => {
          const b = document.createElement("button")
          b.type = "button"
          b.className = "mover"
          b.textContent = simbolo
          b.title = ayuda
          b.setAttribute("aria-label", `${ayuda}: ${nombre.textContent}`)
          const j = i + delta
          b.disabled = j < 0 || j >= cfg.columnas.length
          b.addEventListener("click", () => {
            ;[cfg.columnas[i], cfg.columnas[j]] = [cfg.columnas[j], cfg.columnas[i]]
            guardar()
            render()
          })
          return b
        }

        li.append(label, mover(-1, "↑", "Subir"), mover(1, "↓", "Bajar"))
        return li
      }),
    )
  }

  document.getElementById("restablecer").addEventListener("click", () => {
    cfg = CIVA_CONFIG.normalizar(null)
    guardar()
    render()
  })

  render()
})()
