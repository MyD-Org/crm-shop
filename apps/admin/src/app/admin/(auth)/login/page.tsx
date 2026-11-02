"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button, Input, Field, Alert } from "@myd-org/ui"
import { CodigosRespaldo } from "@/components/admin/CodigosRespaldo"

type Paso = "credenciales" | "verificar" | "alta" | "codigos"
type PantallaAlta = { qrSvg: string; clave: string; cuenta: string; emisor: string }

export default function AdminLoginPage() {
  const router = useRouter()
  // `?expired=1` lo pone /api/admin/auth/expire cuando el guard del área protegida rechaza la
  // sesión (tenant del host distinto al de la cuenta, usuario borrado, cuenta desactivada).
  const expired = useSearchParams().get("expired") === "1"
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  // Segundo paso (verificación en dos pasos, obligatoria para todos).
  const [paso, setPaso] = useState<Paso>("credenciales")
  const [codigo, setCodigo] = useState("")
  const [alta, setAlta] = useState<PantallaAlta | null>(null)
  const [codigosRespaldo, setCodigosRespaldo] = useState<string[]>([])
  const [usarRespaldo, setUsarRespaldo] = useState(false)

  useEffect(() => {
    if (paso !== "alta" || alta) return
    fetch("/api/admin/auth/2fa/alta")
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (res.ok) setAlta(body)
        else volverAlInicio(body.error)
      })
      .catch(() => setError("No se pudo cargar el código QR. Inténtelo de nuevo."))
  }, [paso, alta])

  function volverAlInicio(mensaje?: string) {
    setPaso("credenciales")
    setCodigo("")
    setAlta(null)
    setUsarRespaldo(false)
    setPassword("")
    setError(mensaje ?? "")
  }

  async function enviarCodigo(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const url = paso === "alta" ? "/api/admin/auth/2fa/alta" : "/api/admin/auth/2fa/verificar"
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ codigo }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (body.code === "vencido") volverAlInicio(body.error)
        else setError(body.error ?? "Código incorrecto")
        return
      }
      if (paso === "alta") {
        setCodigosRespaldo(body.codigosRespaldo ?? [])
        setPaso("codigos")
        return
      }
      router.push("/admin/inbox")
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      if (res.ok) {
        const body = await res.json().catch(() => ({}))
        if (body.paso === "verificar" || body.paso === "alta") {
          setPaso(body.paso)
          setCodigo("")
        } else {
          router.push("/admin/inbox")
        }
      } else {
        const body = await res.json()
        setError(body.error ?? "Error al iniciar sesión")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="w-full p-6 sm:p-8"
      style={{
        maxWidth: 408,
        background: "var(--card)",
        borderRadius: 16,
        borderTop: "3px solid var(--blue-bright)",
        boxShadow: "0 4px 32px rgba(12,62,214,0.08), 0 1px 4px rgba(0,0,0,0.06)",
      }}
    >
      <div className="flex flex-col gap-1.5 mb-6">
        <h1 className="text-xl font-semibold" style={{ color: "var(--ink)" }}>
          {paso === "credenciales" ? "Backoffice" : paso === "codigos" ? "Códigos de respaldo" : "Verificación en dos pasos"}
        </h1>
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
          {paso === "credenciales" && "Ingrese con su email y contraseña"}
          {paso === "verificar" &&
            (usarRespaldo
              ? "Ingrese uno de sus códigos de respaldo"
              : "Ingrese el código de 6 dígitos de su app autenticadora")}
          {paso === "alta" && "Para proteger su cuenta, configure una app autenticadora en su celular."}
          {paso === "codigos" && "Último paso antes de ingresar"}
        </p>
      </div>

      {paso === "codigos" && (
        <CodigosRespaldo codigos={codigosRespaldo} onContinuar={() => router.push("/admin/inbox")} />
      )}

      {(paso === "verificar" || paso === "alta") && (
        <form onSubmit={enviarCodigo} className="flex flex-col gap-4">
          {paso === "alta" && (
            <ol className="flex flex-col gap-3 text-sm" style={{ color: "var(--ink)" }}>
              <li>
                1. Instale Google Authenticator, Microsoft Authenticator o Authy en su celular (son gratuitas).
              </li>
              <li className="flex flex-col gap-2">
                <span>2. En la app, toque “Agregar” y escanee este código:</span>
                {alta ? (
                  <div
                    className="w-44 h-44 self-center bg-white p-2 rounded-lg"
                    aria-label="Código QR para la app autenticadora"
                    // SVG generado en el servidor por la librería qrcode a partir de nuestros datos.
                    dangerouslySetInnerHTML={{ __html: alta.qrSvg }}
                  />
                ) : (
                  <div className="w-44 h-44 self-center rounded-lg animate-pulse" style={{ background: "var(--surface-2, #f4f6f9)" }} />
                )}
                {alta && (
                  <span className="text-xs" style={{ color: "var(--ink-soft)" }}>
                    ¿No puede escanear? Ingrese esta clave a mano:{" "}
                    <code className="font-mono break-all" style={{ color: "var(--ink)" }}>{alta.clave}</code>
                  </span>
                )}
              </li>
              <li>3. Escriba el código de 6 dígitos que muestra la app.</li>
            </ol>
          )}

          <Field label={usarRespaldo ? "Código de respaldo" : "Código"}>
            <Input
              inputMode={usarRespaldo ? "text" : "numeric"}
              autoComplete="one-time-code"
              autoFocus
              maxLength={usarRespaldo ? 11 : 7}
              placeholder={usarRespaldo ? "ABCDE-FGHJK" : "123456"}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              required
            />
          </Field>

          {error && <Alert tone="danger">{error}</Alert>}

          <Button type="submit" loading={loading} className="w-full justify-center">
            {loading ? "Verificando..." : paso === "alta" ? "Activar e ingresar" : "Verificar"}
          </Button>

          <div className="flex justify-between text-xs">
            <button type="button" className="hover:underline" style={{ color: "var(--blue)" }} onClick={() => volverAlInicio()}>
              Volver
            </button>
            {paso === "verificar" && (
              <button
                type="button"
                className="hover:underline"
                style={{ color: "var(--blue)" }}
                onClick={() => {
                  setUsarRespaldo((v) => !v)
                  setCodigo("")
                  setError("")
                }}
              >
                {usarRespaldo ? "Usar la app autenticadora" : "Usar un código de respaldo"}
              </button>
            )}
          </div>
        </form>
      )}

      {paso === "credenciales" && (<>

      {expired && !error && paso === "credenciales" && (
        <div className="mb-4">
          <Alert tone="warning">Su sesión expiró, vuelva a ingresar.</Alert>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Email">
          <Input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>

        <Field label="Contraseña">
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>

        {error && <Alert tone="danger">{error}</Alert>}

        <Button type="submit" loading={loading} className="w-full justify-center">
          {loading ? "Ingresando..." : "Ingresar"}
        </Button>
      </form>

      <Link
        href="/admin/forgot-password"
        className="block text-center text-xs mt-4 hover:underline"
        style={{ color: "var(--blue)" }}
      >
        Olvidé mi contraseña
      </Link>
      </>)}
    </div>
  )
}
