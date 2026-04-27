import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuth } from './store/useAuth'
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

function Protected({ children }: { children: JSX.Element }) {
  const { user, hydrating } = useAuth()
  if (hydrating) return <div className="p-8 text-center text-slate-500">Cargando…</div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  const hydrate = useAuth((s) => s.hydrate)
  useEffect(() => { hydrate() }, [hydrate])

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
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
