# Portal de Clientes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portal web de solo lectura donde clientes existentes pueden iniciar sesión con CUIT o email, ver su saldo de cuenta corriente, deudas pendientes, historial de facturas y descargar PDFs — todo consumido desde la API de Flexxus v5.

**Architecture:** Next.js 15 App Router con route groups `(auth)` y `(portal)`. Flexxus solo se consulta desde el servidor (API routes). Autenticación via OTP de 6 dígitos enviado al email del cliente registrado en Flexxus. Sesión gestionada con iron-session (cookie cifrada, sin JWT externo). Solo se usa Prisma/PostgreSQL para almacenar los tokens OTP temporales.

**Tech Stack:** Next.js 15, TypeScript, Tailwind CSS 4, Prisma + PostgreSQL, iron-session, Resend (emails), Flexxus API v5.

---

## File Structure

```
src/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx             — formulario CUIT/email
│   │   └── verificar/page.tsx         — formulario código OTP
│   ├── (portal)/
│   │   ├── layout.tsx                 — wrapper autenticado
│   │   ├── dashboard/page.tsx         — resumen general
│   │   ├── cuenta-corriente/page.tsx  — saldo + movimientos
│   │   ├── facturas/page.tsx          — listado de facturas
│   │   └── perfil/page.tsx            — datos del cliente
│   ├── api/
│   │   ├── auth/login/route.ts        — busca cliente en Flexxus + envía OTP
│   │   ├── auth/verificar/route.ts    — verifica OTP + crea sesión
│   │   ├── auth/logout/route.ts       — destruye sesión
│   │   ├── cliente/route.ts           — GET datos del cliente
│   │   ├── cliente/saldo/route.ts     — GET saldo CC
│   │   ├── cliente/deudas/route.ts    — GET deudas pendientes
│   │   ├── cliente/movimientos/route.ts — GET movimientos CC
│   │   └── facturas/[tipo]/[numero]/pdf/route.ts — proxy PDF de Flexxus
│   └── layout.tsx
├── lib/
│   ├── flexxus.ts     — cliente HTTP para Flexxus API
│   ├── session.ts     — config iron-session
│   ├── otp.ts         — generar/verificar OTP
│   └── email.ts       — enviar email con Resend
├── components/
│   ├── ui/
│   │   ├── Card.tsx
│   │   ├── Badge.tsx
│   │   └── DataTable.tsx
│   └── portal/
│       ├── Navbar.tsx
│       ├── BalanceCard.tsx
│       ├── DeudaRow.tsx
│       └── FacturaRow.tsx
└── middleware.ts      — protege rutas /portal/*
prisma/schema.prisma   — tabla otp_tokens
.env.local
```

---

## Task 1: Setup del proyecto

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`
- Create: `.env.local`
- Create: `prisma/schema.prisma`

- [ ] **Step 1: Inicializar Next.js 15**

```bash
cd /Users/dalilacabeza/Documents/Fede/Shop
npx create-next-app@latest . --typescript --tailwind --app --src-dir --no-git --yes
```

Expected: proyecto creado con App Router en `src/app/`

- [ ] **Step 2: Instalar dependencias**

```bash
npm install iron-session @prisma/client resend
npm install -D prisma
```

- [ ] **Step 3: Crear schema de Prisma**

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model OtpToken {
  id        String   @id @default(cuid())
  cuit      String
  code      String
  expiresAt DateTime
  used      Boolean  @default(false)
  createdAt DateTime @default(now())

  @@index([cuit])
}
```

- [ ] **Step 4: Crear `.env.local`**

```env
DATABASE_URL=postgresql://user:password@localhost:5432/portal_clientes
FLEXXUS_BASE_URL=https://TU_DOMINIO/v5
FLEXXUS_USERNAME=usuario_flexxus
FLEXXUS_PASSWORD=password_flexxus
RESEND_API_KEY=re_xxxxxxxxxxxx
SESSION_SECRET=una_clave_secreta_de_al_menos_32_caracteres_aqui
```

- [ ] **Step 5: Generar cliente Prisma y correr migración**

```bash
npx prisma migrate dev --name init
```

Expected: tabla `OtpToken` creada en PostgreSQL

- [ ] **Step 6: Commit**

```bash
git init && git add . && git commit -m "feat: project setup"
```

---

## Task 2: Cliente Flexxus

**Files:**
- Create: `src/lib/flexxus.ts`

- [ ] **Step 1: Escribir test**

```typescript
// src/lib/flexxus.test.ts
import { getFlexxusClient, buscarCliente } from './flexxus'

test('buscarCliente retorna cliente por CUIT', async () => {
  const cliente = await buscarCliente('20301234567')
  expect(cliente).toHaveProperty('codigocliente')
  expect(cliente).toHaveProperty('razonsocial')
})
```

- [ ] **Step 2: Correr test — debe fallar**

```bash
npx jest src/lib/flexxus.test.ts
```

Expected: FAIL — `Cannot find module './flexxus'`

- [ ] **Step 3: Implementar el cliente**

```typescript
// src/lib/flexxus.ts
const BASE_URL = process.env.FLEXXUS_BASE_URL!
let token: string | null = null

async function login() {
  const res = await fetch(`${BASE_URL}/autorizacion/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.FLEXXUS_USERNAME,
      password: process.env.FLEXXUS_PASSWORD,
      deviceinfo: { model: 'Web', platform: 'browser', uuid: 'portal-web', version: '1.0', manufacturer: 'Web' },
    }),
  })
  if (!res.ok) throw new Error(`Flexxus login failed: ${res.status}`)
  const data = await res.json()
  token = data.token
}

async function apiFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!token) await login()

  const url = new URL(`${BASE_URL}${path}`)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })

  if (res.status === 401) {
    await login()
    const retry = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!retry.ok) throw new Error(`Flexxus error ${retry.status}: ${path}`)
    return retry.json()
  }

  if (!res.ok) throw new Error(`Flexxus error ${res.status}: ${path}`)
  return res.json()
}

export async function buscarCliente(busqueda: string) {
  const results = await apiFetch<any[]>(`/clientes/busquedavariada/${encodeURIComponent(busqueda)}`)
  return results?.[0] ?? null
}

export async function getCliente(codigocliente: string) {
  return apiFetch<any>(`/clientes/${codigocliente}`)
}

export async function getSaldoCC(codigocliente: string) {
  return apiFetch<any>(`/clientes/${codigocliente}/saldoscuentacorriente`)
}

export async function getDeudas(codigocliente: string) {
  return apiFetch<any[]>(`/clientes/${codigocliente}/deudas`)
}

export async function getMovimientos(codigocliente: string, params?: { fechadesde?: string; fechahasta?: string }) {
  return apiFetch<any[]>(`/clientes/${codigocliente}/movimientos`, params ?? {})
}

export async function getFacturas(codigocliente: string) {
  return apiFetch<any[]>(`/ventas/comprobantes/${codigocliente}`)
}

export async function getFacturaPdf(tipo: string, numero: string): Promise<ArrayBuffer> {
  if (!token) await login()
  const url = `${BASE_URL}/ventas/${tipo}/${numero}/pdf`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`PDF error ${res.status}`)
  return res.arrayBuffer()
}
```

- [ ] **Step 4: Correr test — debe pasar**

```bash
npx jest src/lib/flexxus.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/flexxus.ts && git commit -m "feat: flexxus api client"
```

---

## Task 3: Sistema OTP

**Files:**
- Create: `src/lib/otp.ts`
- Create: `src/lib/email.ts`

- [ ] **Step 1: Escribir tests OTP**

```typescript
// src/lib/otp.test.ts
import { generarOtp, verificarOtp } from './otp'

test('genera OTP de 6 dígitos', async () => {
  const { code } = await generarOtp('20301234567')
  expect(code).toMatch(/^\d{6}$/)
})

test('verifica OTP válido', async () => {
  const { code } = await generarOtp('20301234567')
  const resultado = await verificarOtp('20301234567', code)
  expect(resultado).toBe(true)
})

test('rechaza OTP ya usado', async () => {
  const { code } = await generarOtp('20301234567')
  await verificarOtp('20301234567', code)
  const resultado = await verificarOtp('20301234567', code)
  expect(resultado).toBe(false)
})
```

- [ ] **Step 2: Correr tests — deben fallar**

```bash
npx jest src/lib/otp.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implementar OTP**

```typescript
// src/lib/otp.ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function generarOtp(cuit: string) {
  const code = Math.floor(100000 + Math.random() * 900000).toString()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutos

  await prisma.otpToken.create({ data: { cuit, code, expiresAt } })
  return { code }
}

export async function verificarOtp(cuit: string, code: string): Promise<boolean> {
  const token = await prisma.otpToken.findFirst({
    where: { cuit, code, used: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  })

  if (!token) return false

  await prisma.otpToken.update({ where: { id: token.id }, data: { used: true } })
  return true
}
```

- [ ] **Step 4: Implementar email**

```typescript
// src/lib/email.ts
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function enviarOtp(email: string, code: string, nombreCliente: string) {
  await resend.emails.send({
    from: 'Portal Clientes <noreply@tudominio.com.ar>',
    to: email,
    subject: 'Tu código de acceso',
    html: `
      <p>Hola ${nombreCliente},</p>
      <p>Tu código de acceso al portal es:</p>
      <h1 style="font-size:40px;letter-spacing:8px;font-family:monospace">${code}</h1>
      <p>Válido por 10 minutos. Si no solicitaste este código, ignorá este email.</p>
    `,
  })
}
```

- [ ] **Step 5: Correr tests — deben pasar**

```bash
npx jest src/lib/otp.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/otp.ts src/lib/email.ts && git commit -m "feat: otp generation and email"
```

---

## Task 4: Sesión con iron-session

**Files:**
- Create: `src/lib/session.ts`
- Create: `src/middleware.ts`

- [ ] **Step 1: Configurar iron-session**

```typescript
// src/lib/session.ts
import { getIronSession, IronSession } from 'iron-session'
import { cookies } from 'next/headers'

export interface SessionData {
  codigocliente: string
  razonsocial: string
  email: string
  cuit: string
}

const sessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: 'portal_session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 8, // 8 horas
  },
}

export async function getSession(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(await cookies(), sessionOptions)
}
```

- [ ] **Step 2: Crear middleware de protección**

```typescript
// src/middleware.ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const session = request.cookies.get('portal_session')
  const isPortalRoute = request.nextUrl.pathname.startsWith('/dashboard') ||
    request.nextUrl.pathname.startsWith('/cuenta-corriente') ||
    request.nextUrl.pathname.startsWith('/facturas') ||
    request.nextUrl.pathname.startsWith('/perfil')

  if (isPortalRoute && !session) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*', '/cuenta-corriente/:path*', '/facturas/:path*', '/perfil/:path*'],
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/session.ts src/middleware.ts && git commit -m "feat: session management and auth middleware"
```

---

## Task 5: API Routes de autenticación

**Files:**
- Create: `src/app/api/auth/login/route.ts`
- Create: `src/app/api/auth/verificar/route.ts`
- Create: `src/app/api/auth/logout/route.ts`

- [ ] **Step 1: Implementar route de login**

```typescript
// src/app/api/auth/login/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { buscarCliente } from '@/lib/flexxus'
import { generarOtp } from '@/lib/otp'
import { enviarOtp } from '@/lib/email'

export async function POST(req: NextRequest) {
  const { busqueda } = await req.json()

  if (!busqueda?.trim()) {
    return NextResponse.json({ error: 'CUIT o email requerido' }, { status: 400 })
  }

  const cliente = await buscarCliente(busqueda.trim())

  if (!cliente) {
    return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })
  }

  if (!cliente.mail) {
    return NextResponse.json({ error: 'El cliente no tiene email registrado. Contacte al local.' }, { status: 400 })
  }

  const { code } = await generarOtp(cliente.cuit ?? busqueda)
  await enviarOtp(cliente.mail, code, cliente.razonsocial)

  return NextResponse.json({
    ok: true,
    emailMasked: cliente.mail.replace(/(.{2}).+(@.+)/, '$1***$2'),
    cuit: cliente.cuit,
  })
}
```

- [ ] **Step 2: Implementar route de verificación**

```typescript
// src/app/api/auth/verificar/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { verificarOtp } from '@/lib/otp'
import { buscarCliente } from '@/lib/flexxus'
import { getSession } from '@/lib/session'

export async function POST(req: NextRequest) {
  const { cuit, code } = await req.json()

  if (!cuit || !code) {
    return NextResponse.json({ error: 'CUIT y código requeridos' }, { status: 400 })
  }

  const valido = await verificarOtp(cuit, code)

  if (!valido) {
    return NextResponse.json({ error: 'Código inválido o expirado' }, { status: 401 })
  }

  const cliente = await buscarCliente(cuit)
  const session = await getSession()

  session.codigocliente = cliente.codigocliente
  session.razonsocial = cliente.razonsocial
  session.email = cliente.mail
  session.cuit = cuit

  await session.save()

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Implementar route de logout**

```typescript
// src/app/api/auth/logout/route.ts
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'

export async function POST() {
  const session = await getSession()
  session.destroy()
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/auth/ && git commit -m "feat: auth api routes (login, verify, logout)"
```

---

## Task 6: API Routes del portal

**Files:**
- Create: `src/app/api/cliente/route.ts`
- Create: `src/app/api/cliente/saldo/route.ts`
- Create: `src/app/api/cliente/deudas/route.ts`
- Create: `src/app/api/cliente/movimientos/route.ts`
- Create: `src/app/api/facturas/[tipo]/[numero]/pdf/route.ts`

- [ ] **Step 1: Route datos del cliente**

```typescript
// src/app/api/cliente/route.ts
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getCliente } from '@/lib/flexxus'

export async function GET() {
  const session = await getSession()
  if (!session.codigocliente) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const cliente = await getCliente(session.codigocliente)
  return NextResponse.json(cliente)
}
```

- [ ] **Step 2: Route saldo de cuenta corriente**

```typescript
// src/app/api/cliente/saldo/route.ts
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getSaldoCC } from '@/lib/flexxus'

export async function GET() {
  const session = await getSession()
  if (!session.codigocliente) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const saldo = await getSaldoCC(session.codigocliente)
  return NextResponse.json(saldo)
}
```

- [ ] **Step 3: Route deudas pendientes**

```typescript
// src/app/api/cliente/deudas/route.ts
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getDeudas } from '@/lib/flexxus'

export async function GET() {
  const session = await getSession()
  if (!session.codigocliente) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const deudas = await getDeudas(session.codigocliente)
  return NextResponse.json(deudas)
}
```

- [ ] **Step 4: Route movimientos**

```typescript
// src/app/api/cliente/movimientos/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getMovimientos } from '@/lib/flexxus'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session.codigocliente) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const params = {
    fechadesde: searchParams.get('fechadesde') ?? undefined,
    fechahasta: searchParams.get('fechahasta') ?? undefined,
  }

  const movimientos = await getMovimientos(session.codigocliente, params)
  return NextResponse.json(movimientos)
}
```

- [ ] **Step 5: Route PDF de factura (proxy)**

```typescript
// src/app/api/facturas/[tipo]/[numero]/pdf/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getFacturaPdf } from '@/lib/flexxus'

export async function GET(
  _req: NextRequest,
  { params }: { params: { tipo: string; numero: string } }
) {
  const session = await getSession()
  if (!session.codigocliente) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const buffer = await getFacturaPdf(params.tipo, params.numero)

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="factura-${params.tipo}-${params.numero}.pdf"`,
    },
  })
}
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/cliente/ src/app/api/facturas/ && git commit -m "feat: portal api routes"
```

---

## Task 7: Páginas de autenticación (UI)

**Files:**
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/verificar/page.tsx`

- [ ] **Step 1: Página de login**

```tsx
// src/app/(auth)/login/page.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [busqueda, setBusqueda] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ busqueda }),
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error)
      setLoading(false)
      return
    }

    sessionStorage.setItem('login_cuit', data.cuit)
    sessionStorage.setItem('login_email', data.emailMasked)
    router.push('/verificar')
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-2xl shadow-sm w-full max-w-sm">
        <h1 className="text-2xl font-semibold mb-2">Portal de clientes</h1>
        <p className="text-gray-500 text-sm mb-6">Ingresá tu CUIT o email registrado</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            placeholder="CUIT o email"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-3 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Verificando...' : 'Continuar'}
          </button>
        </form>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Página de verificación OTP**

```tsx
// src/app/(auth)/verificar/page.tsx
'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function VerificarPage() {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [emailMasked, setEmailMasked] = useState('')
  const router = useRouter()

  useEffect(() => {
    setEmailMasked(sessionStorage.getItem('login_email') ?? '')
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const cuit = sessionStorage.getItem('login_cuit')
    const res = await fetch('/api/auth/verificar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cuit, code }),
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error)
      setLoading(false)
      return
    }

    router.push('/dashboard')
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-2xl shadow-sm w-full max-w-sm">
        <h1 className="text-2xl font-semibold mb-2">Código de verificación</h1>
        <p className="text-gray-500 text-sm mb-6">
          Enviamos un código a <strong>{emailMasked}</strong>. Válido por 10 minutos.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            inputMode="numeric"
            placeholder="000000"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="w-full border border-gray-200 rounded-lg px-4 py-3 text-center text-2xl font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading || code.length < 6}
            className="w-full bg-blue-600 text-white py-3 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Verificando...' : 'Ingresar'}
          </button>
          <button type="button" onClick={() => router.push('/login')} className="w-full text-sm text-gray-500 hover:underline">
            Volver
          </button>
        </form>
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/\(auth\)/ && git commit -m "feat: login and otp verification pages"
```

---

## Task 8: Layout y Navbar del portal

**Files:**
- Create: `src/app/(portal)/layout.tsx`
- Create: `src/components/portal/Navbar.tsx`

- [ ] **Step 1: Navbar**

```tsx
// src/components/portal/Navbar.tsx
'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export function Navbar({ razonsocial }: { razonsocial: string }) {
  const router = useRouter()

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  return (
    <header className="border-b bg-white">
      <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
        <nav className="flex gap-6 text-sm">
          <Link href="/dashboard" className="font-medium hover:text-blue-600">Inicio</Link>
          <Link href="/cuenta-corriente" className="hover:text-blue-600">Cuenta corriente</Link>
          <Link href="/facturas" className="hover:text-blue-600">Facturas</Link>
          <Link href="/perfil" className="hover:text-blue-600">Mi perfil</Link>
        </nav>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500 hidden md:block">{razonsocial}</span>
          <button onClick={logout} className="text-sm text-gray-500 hover:text-red-500">Salir</button>
        </div>
      </div>
    </header>
  )
}
```

- [ ] **Step 2: Layout del portal**

```tsx
// src/app/(portal)/layout.tsx
import { getSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import { Navbar } from '@/components/portal/Navbar'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session.codigocliente) redirect('/login')

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar razonsocial={session.razonsocial} />
      <main className="max-w-5xl mx-auto px-4 py-8">{children}</main>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/\(portal\)/layout.tsx src/components/portal/Navbar.tsx && git commit -m "feat: portal layout and navbar"
```

---

## Task 9: Dashboard

**Files:**
- Create: `src/app/(portal)/dashboard/page.tsx`
- Create: `src/components/portal/BalanceCard.tsx`

- [ ] **Step 1: BalanceCard component**

```tsx
// src/components/portal/BalanceCard.tsx
export function BalanceCard({ titulo, monto, tipo }: {
  titulo: string
  monto: number
  tipo: 'saldo' | 'deuda' | 'neutro'
}) {
  const colors = {
    saldo: 'text-green-600 bg-green-50',
    deuda: 'text-red-600 bg-red-50',
    neutro: 'text-blue-600 bg-blue-50',
  }

  return (
    <div className="bg-white rounded-xl border p-6">
      <p className="text-sm text-gray-500 mb-1">{titulo}</p>
      <p className={`text-2xl font-semibold ${colors[tipo]?.split(' ')[0]}`}>
        {new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(monto)}
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Dashboard page**

```tsx
// src/app/(portal)/dashboard/page.tsx
import { getSession } from '@/lib/session'
import { getSaldoCC, getDeudas } from '@/lib/flexxus'
import { BalanceCard } from '@/components/portal/BalanceCard'
import Link from 'next/link'

export default async function DashboardPage() {
  const session = await getSession()
  const [saldo, deudas] = await Promise.all([
    getSaldoCC(session.codigocliente!),
    getDeudas(session.codigocliente!),
  ])

  const deudasVencidas = deudas.filter((d: any) => new Date(d.fechavencimiento) < new Date())
  const totalDeuda = deudas.reduce((acc: number, d: any) => acc + (d.deudatotal ?? 0), 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Bienvenido, {session.razonsocial}</h1>
        <p className="text-gray-500 text-sm mt-1">Resumen de tu cuenta</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <BalanceCard titulo="Saldo cuenta corriente" monto={saldo?.saldo ?? 0} tipo="neutro" />
        <BalanceCard titulo="Deuda total" monto={totalDeuda} tipo={totalDeuda > 0 ? 'deuda' : 'saldo'} />
        <BalanceCard titulo="Comprobantes vencidos" monto={deudasVencidas.length} tipo={deudasVencidas.length > 0 ? 'deuda' : 'saldo'} />
      </div>

      {deudasVencidas.length > 0 && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-4">
          <p className="text-red-700 text-sm font-medium">
            Tenés {deudasVencidas.length} comprobante{deudasVencidas.length > 1 ? 's' : ''} vencido{deudasVencidas.length > 1 ? 's' : ''}.{' '}
            <Link href="/cuenta-corriente" className="underline">Ver detalle →</Link>
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link href="/cuenta-corriente" className="bg-white border rounded-xl p-6 hover:border-blue-200 hover:shadow-sm transition-all">
          <p className="font-medium">Cuenta corriente</p>
          <p className="text-sm text-gray-500 mt-1">Ver movimientos, deudas y vencimientos</p>
        </Link>
        <Link href="/facturas" className="bg-white border rounded-xl p-6 hover:border-blue-200 hover:shadow-sm transition-all">
          <p className="font-medium">Mis facturas</p>
          <p className="text-sm text-gray-500 mt-1">Descargar comprobantes en PDF</p>
        </Link>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/\(portal\)/dashboard/ src/components/portal/BalanceCard.tsx && git commit -m "feat: dashboard page"
```

---

## Task 10: Cuenta Corriente

**Files:**
- Create: `src/app/(portal)/cuenta-corriente/page.tsx`
- Create: `src/components/portal/DeudaRow.tsx`

- [ ] **Step 1: DeudaRow component**

```tsx
// src/components/portal/DeudaRow.tsx
export function DeudaRow({ deuda }: { deuda: any }) {
  const vencida = new Date(deuda.fechavencimiento) < new Date()

  return (
    <tr className="border-t text-sm">
      <td className="py-3 pr-4">{deuda.tipocomprobante} {deuda.numerocomprobante}</td>
      <td className="py-3 pr-4 text-gray-500">{new Date(deuda.fechacomprobante).toLocaleDateString('es-AR')}</td>
      <td className={`py-3 pr-4 ${vencida ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
        {new Date(deuda.fechavencimiento).toLocaleDateString('es-AR')}
        {vencida && <span className="ml-2 text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">Vencida</span>}
      </td>
      <td className="py-3 text-right font-medium">
        {new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(deuda.deudatotal ?? 0)}
      </td>
    </tr>
  )
}
```

- [ ] **Step 2: Página cuenta corriente**

```tsx
// src/app/(portal)/cuenta-corriente/page.tsx
import { getSession } from '@/lib/session'
import { getSaldoCC, getDeudas } from '@/lib/flexxus'
import { DeudaRow } from '@/components/portal/DeudaRow'
import { BalanceCard } from '@/components/portal/BalanceCard'

export default async function CuentaCorrientePage() {
  const session = await getSession()
  const [saldo, deudas] = await Promise.all([
    getSaldoCC(session.codigocliente!),
    getDeudas(session.codigocliente!),
  ])

  const totalDeuda = deudas.reduce((acc: number, d: any) => acc + (d.deudatotal ?? 0), 0)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Cuenta corriente</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BalanceCard titulo="Saldo" monto={saldo?.saldo ?? 0} tipo="neutro" />
        <BalanceCard titulo="Deuda total" monto={totalDeuda} tipo={totalDeuda > 0 ? 'deuda' : 'saldo'} />
      </div>

      <div className="bg-white rounded-xl border">
        <div className="p-4 border-b">
          <h2 className="font-medium">Comprobantes pendientes</h2>
        </div>
        <div className="p-4 overflow-x-auto">
          {deudas.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-8">No tenés deudas pendientes</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wider">
                  <th className="pb-3 pr-4">Comprobante</th>
                  <th className="pb-3 pr-4">Fecha</th>
                  <th className="pb-3 pr-4">Vencimiento</th>
                  <th className="pb-3 text-right">Importe</th>
                </tr>
              </thead>
              <tbody>
                {deudas.map((deuda: any) => (
                  <DeudaRow key={deuda.numerocomprobante} deuda={deuda} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/\(portal\)/cuenta-corriente/ src/components/portal/DeudaRow.tsx && git commit -m "feat: cuenta corriente page"
```

---

## Task 11: Facturas con descarga PDF

**Files:**
- Create: `src/app/(portal)/facturas/page.tsx`
- Create: `src/components/portal/FacturaRow.tsx`

- [ ] **Step 1: FacturaRow component**

```tsx
// src/components/portal/FacturaRow.tsx
'use client'

export function FacturaRow({ factura }: { factura: any }) {
  function descargarPdf() {
    window.open(`/api/facturas/${factura.tipocomprobante}/${factura.numerocomprobante}/pdf`, '_blank')
  }

  return (
    <tr className="border-t text-sm">
      <td className="py-3 pr-4 font-mono">{factura.tipocomprobante} {factura.numerocomprobante}</td>
      <td className="py-3 pr-4 text-gray-500">{new Date(factura.fechacomprobante).toLocaleDateString('es-AR')}</td>
      <td className="py-3 pr-4">
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          factura.adeudado ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'
        }`}>
          {factura.adeudado ? 'Pendiente' : 'Pagada'}
        </span>
      </td>
      <td className="py-3 pr-4 text-right">
        {new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(factura.total ?? 0)}
      </td>
      <td className="py-3 text-right">
        <button onClick={descargarPdf} className="text-blue-600 hover:underline text-xs">
          Descargar PDF
        </button>
      </td>
    </tr>
  )
}
```

- [ ] **Step 2: Página facturas**

```tsx
// src/app/(portal)/facturas/page.tsx
import { getSession } from '@/lib/session'
import { getFacturas } from '@/lib/flexxus'
import { FacturaRow } from '@/components/portal/FacturaRow'

export default async function FacturasPage() {
  const session = await getSession()
  const facturas = await getFacturas(session.codigocliente!)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Mis facturas</h1>

      <div className="bg-white rounded-xl border">
        <div className="overflow-x-auto">
          {facturas.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-8">No hay facturas registradas</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b">
                  <th className="p-4 pr-4">Comprobante</th>
                  <th className="p-4 pr-4">Fecha</th>
                  <th className="p-4 pr-4">Estado</th>
                  <th className="p-4 pr-4 text-right">Total</th>
                  <th className="p-4 text-right">PDF</th>
                </tr>
              </thead>
              <tbody>
                {facturas.map((f: any) => (
                  <FacturaRow key={`${f.tipocomprobante}-${f.numerocomprobante}`} factura={f} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/\(portal\)/facturas/ src/components/portal/FacturaRow.tsx && git commit -m "feat: facturas page with pdf download"
```

---

## Task 12: Página de perfil

**Files:**
- Create: `src/app/(portal)/perfil/page.tsx`

- [ ] **Step 1: Implementar página perfil**

```tsx
// src/app/(portal)/perfil/page.tsx
import { getSession } from '@/lib/session'
import { getCliente } from '@/lib/flexxus'

export default async function PerfilPage() {
  const session = await getSession()
  const cliente = await getCliente(session.codigocliente!)

  const campos = [
    { label: 'Razón social', valor: cliente.razonsocial },
    { label: 'CUIT', valor: cliente.cuit },
    { label: 'Email', valor: cliente.mail },
    { label: 'Teléfono', valor: cliente.telefono },
    { label: 'Dirección', valor: cliente.direccion },
    { label: 'Localidad', valor: cliente.localidad },
    { label: 'Provincia', valor: cliente.provincia },
    { label: 'Condición IVA', valor: cliente.condicioniva },
  ]

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Mi perfil</h1>
      <p className="text-gray-500 text-sm">Para actualizar tus datos, contactá al local.</p>

      <div className="bg-white rounded-xl border divide-y">
        {campos.map(({ label, valor }) => valor && (
          <div key={label} className="flex px-6 py-4">
            <span className="text-sm text-gray-500 w-40">{label}</span>
            <span className="text-sm font-medium">{valor}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(portal\)/perfil/ && git commit -m "feat: perfil page"
```

---

## Task 13: Deploy a Vercel

**Files:**
- Create: `vercel.json` (si se necesita configuración)

- [ ] **Step 1: Crear repo en GitHub**

```bash
git remote add origin https://github.com/TU_USUARIO/portal-clientes.git
git push -u origin main
```

- [ ] **Step 2: Importar en Vercel**

1. Ir a vercel.com → "Add New Project"
2. Importar el repo de GitHub
3. Agregar variables de entorno (todas las del `.env.local`)

- [ ] **Step 3: Agregar base de datos PostgreSQL**

En Vercel → Storage → Create Database → PostgreSQL
Copiar la `DATABASE_URL` generada a las variables de entorno del proyecto.

- [ ] **Step 4: Correr migración en producción**

```bash
npx prisma migrate deploy
```

- [ ] **Step 5: Verificar deploy**

Abrir la URL de Vercel → ir a `/login` → ingresar CUIT de un cliente de prueba → verificar flujo completo.

---

## Task 14: Retenciones aplicadas al cliente

**Files:**
- Modify: `src/lib/flexxus.ts` — agregar `getRetencionesAplicadas`
- Create: `src/app/api/cliente/retenciones/route.ts`
- Create: `src/app/(portal)/retenciones/page.tsx`
- Modify: `src/components/portal/Navbar.tsx` — agregar link

- [ ] **Step 1: Agregar función en flexxus.ts**

```typescript
// agregar en src/lib/flexxus.ts
export async function getRetencionesAplicadas(
  codigocliente: string,
  params?: { codigoretencion?: string; fechadesde?: string; fechahasta?: string }
) {
  return apiFetch<any[]>(`/clientes/${codigocliente}/retencionesaplicadas`, params ?? {})
}
```

- [ ] **Step 2: Escribir test**

```typescript
// src/lib/flexxus.test.ts — agregar este test
test('getRetencionesAplicadas retorna array', async () => {
  const retenciones = await getRetencionesAplicadas('CLI001')
  expect(Array.isArray(retenciones)).toBe(true)
})
```

- [ ] **Step 3: Correr test — debe pasar**

```bash
npx jest src/lib/flexxus.test.ts --testNamePattern="getRetencionesAplicadas"
```

Expected: PASS

- [ ] **Step 4: Crear API route**

```typescript
// src/app/api/cliente/retenciones/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getRetencionesAplicadas } from '@/lib/flexxus'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session.codigocliente) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const params = {
    fechadesde: searchParams.get('fechadesde') ?? undefined,
    fechahasta: searchParams.get('fechahasta') ?? undefined,
  }

  const retenciones = await getRetencionesAplicadas(session.codigocliente, params)
  return NextResponse.json(retenciones)
}
```

- [ ] **Step 5: Crear página retenciones**

```tsx
// src/app/(portal)/retenciones/page.tsx
import { getSession } from '@/lib/session'
import { getRetencionesAplicadas } from '@/lib/flexxus'

export default async function RetencionesPage() {
  const session = await getSession()
  const retenciones = await getRetencionesAplicadas(session.codigocliente!)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Retenciones</h1>

      <div className="bg-white rounded-xl border">
        <div className="overflow-x-auto">
          {retenciones.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-8">No hay retenciones registradas</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b">
                  <th className="p-4">Tipo</th>
                  <th className="p-4">Número</th>
                  <th className="p-4">Fecha</th>
                  <th className="p-4 text-right">Monto</th>
                </tr>
              </thead>
              <tbody>
                {retenciones.map((r: any, i: number) => (
                  <tr key={i} className="border-t text-sm">
                    <td className="p-4">{r.descripcionretencion ?? r.codigoretencion}</td>
                    <td className="p-4 font-mono text-gray-500">{r.numeroretencion}</td>
                    <td className="p-4 text-gray-500">
                      {r.fecha ? new Date(r.fecha).toLocaleDateString('es-AR') : '-'}
                    </td>
                    <td className="p-4 text-right font-medium">
                      {new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(r.monto ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Agregar link en Navbar**

```tsx
// src/components/portal/Navbar.tsx — agregar junto a los otros links
<Link href="/retenciones" className="hover:text-blue-600">Retenciones</Link>
```

- [ ] **Step 7: Actualizar middleware para proteger la ruta**

```typescript
// src/middleware.ts — agregar '/retenciones' al matcher
export const config = {
  matcher: ['/dashboard/:path*', '/cuenta-corriente/:path*', '/facturas/:path*', '/perfil/:path*', '/retenciones/:path*'],
}
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/flexxus.ts src/app/api/cliente/retenciones/ src/app/\(portal\)/retenciones/ src/components/portal/Navbar.tsx src/middleware.ts
git commit -m "feat: retenciones page"
```

---

## Checklist de spec coverage

- [x] Login con CUIT o email → Task 5 + 7
- [x] Verificación OTP por email → Task 3 + 4 + 7
- [x] Datos del cliente → Task 6 + 12
- [x] Saldo de cuenta corriente → Task 6 + 10
- [x] Deudas pendientes con vencimientos → Task 6 + 10
- [x] Historial de movimientos → Task 6 + 10
- [x] Descarga de facturas PDF → Task 6 + 11
- [x] Retenciones aplicadas al cliente → Task 14
- [x] Sesión protegida → Task 4
- [x] Logout → Task 5 + 8
- [x] Deploy → Task 13
