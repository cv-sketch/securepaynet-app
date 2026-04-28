import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuth } from './store/useAuth'
import SessionExpiryModal from './components/SessionExpiryModal'
import { useSessionTimeout } from './hooks/useSessionTimeout'
import { getPinStatus } from './lib/pinApi'
import AppLayout from './layouts/AppLayout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Movimientos from './pages/Movimientos'
import Comprobantes from './pages/Comprobantes'
import Transferir from './pages/Transferir'
import RecibirQR from './pages/RecibirQR'
import Servicios from './pages/Servicios'
import Tarjetas from './pages/Tarjetas'
import Inversiones from './pages/Inversiones'
import Prestamos from './pages/Prestamos'
import Seguridad from './pages/Seguridad'
import Perfil from './pages/Perfil'
import Soporte from './pages/Soporte'
import Legales from './pages/Legales'
import Terminos from './pages/Terminos'
import Privacidad from './pages/Privacidad'
import Arrepentimiento from './pages/Arrepentimiento'
import Baja from './pages/Baja'
import Contactos from './pages/Contactos'
import Signup from './pages/Signup'
import PinSetup from './pages/PinSetup'

type PinGate = { checked: boolean; pinSet: boolean | null }

function Protected({ children }: { children: JSX.Element }) {
  const { user, hydrating, sessionId, signOut } = useAuth()
  const nav = useNavigate()
  const location = useLocation()
  const { idleRemaining, showWarning, expiredReason, refresh } = useSessionTimeout(sessionId)
  const [pin, setPin] = useState<PinGate>({ checked: false, pinSet: null })

  useEffect(() => {
    if (!expiredReason) return
    void (async () => {
      await signOut(expiredReason === 'idle' ? 'idle' : 'absolute')
      nav(`/login?expired=${expiredReason}`, { replace: true })
    })()
  }, [expiredReason, signOut, nav])

  useEffect(() => {
    if (!user || hydrating) return
    if (pin.checked) return
    let cancelled = false
    void (async () => {
      try {
        const s = await getPinStatus()
        if (!cancelled) setPin({ checked: true, pinSet: s.pin_set })
      } catch {
        // Fail-open: don't block on a transient pin-status outage.
        if (!cancelled) setPin({ checked: true, pinSet: null })
      }
    })()
    return () => { cancelled = true }
  }, [user, hydrating, pin.checked])

  if (hydrating) return <div className="p-8 text-center text-slate-500">Cargando…</div>
  if (!user) return <Navigate to="/login" replace />
  if (!pin.checked) return <div className="p-8 text-center text-slate-500">Verificando seguridad…</div>

  if (pin.pinSet === false && location.pathname !== '/pin-setup') {
    return <Navigate to="/pin-setup" replace />
  }
  if (pin.pinSet === true && location.pathname === '/pin-setup') {
    return <Navigate to="/" replace />
  }

  return (
    <>
      {children}
      <SessionExpiryModal
        open={showWarning}
        remainingSeconds={idleRemaining}
        onContinue={refresh}
        onLogout={async () => {
          await signOut('user')
          nav('/login', { replace: true })
        }}
      />
    </>
  )
}

export default function App() {
  const hydrate = useAuth((s) => s.hydrate)
  useEffect(() => { hydrate() }, [hydrate])

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/pin-setup" element={<Protected><PinSetup /></Protected>} />
      <Route element={<Protected><AppLayout /></Protected>}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/movimientos" element={<Movimientos />} />
        <Route path="/comprobantes" element={<Comprobantes />} />
        <Route path="/transferir" element={<Transferir />} />
        <Route path="/contactos" element={<Contactos />} />
        <Route path="/recibir" element={<RecibirQR />} />
        <Route path="/servicios" element={<Servicios />} />
        <Route path="/tarjetas" element={<Tarjetas />} />
        <Route path="/inversiones" element={<Inversiones />} />
        <Route path="/prestamos" element={<Prestamos />} />
        <Route path="/seguridad" element={<Seguridad />} />
        <Route path="/perfil" element={<Perfil />} />
        <Route path="/soporte" element={<Soporte />} />
        <Route path="/legales" element={<Legales />} />
        <Route path="/legales/terminos" element={<Terminos />} />
        <Route path="/legales/privacidad" element={<Privacidad />} />
        <Route path="/legales/arrepentimiento" element={<Arrepentimiento />} />
        <Route path="/legales/baja" element={<Baja />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
