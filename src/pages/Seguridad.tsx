import { useState, useEffect } from 'react'

export default function Seguridad() {
  const [passkeySupported, setPasskeySupported] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && window.PublicKeyCredential) {
      setPasskeySupported(true)
    }
  }, [])

  const handleAddPasskey = () => {
    setMsg('Registro de passkey: proximamente disponible. Estamos finalizando la integracion con WebAuthn.')
  }

  const handleChangePassword = () => {
    setMsg('Cambio de contrasena: pronto disponible desde la app. Por ahora contactanos por Soporte.')
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold">Seguridad</h1>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
        <div className="font-semibold text-sm">Passkeys</div>
        <p className="text-xs text-slate-500">
          Las passkeys reemplazan tu contrasena. Usan biometria o PIN del dispositivo y son mas seguras y rapidas.
        </p>
        <button
          onClick={handleAddPasskey}
          disabled={!passkeySupported}
          className="w-full border border-brand-500 text-brand-600 hover:bg-brand-50 font-semibold py-2.5 rounded-lg disabled:opacity-50"
        >
          {passkeySupported ? 'Agregar passkey en este dispositivo' : 'Tu dispositivo no soporta passkeys'}
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
        <div className="font-semibold text-sm">Contrasena</div>
        <p className="text-xs text-slate-500">
          Te recomendamos cambiar tu contrasena periodicamente y no reutilizarla en otros sitios.
        </p>
        <button
          onClick={handleChangePassword}
          className="w-full border border-slate-300 hover:bg-slate-50 font-semibold py-2.5 rounded-lg"
        >
          Cambiar contrasena
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
        <div className="font-semibold text-sm">Consejos de seguridad</div>
        <ul className="text-xs text-slate-600 list-disc pl-4 space-y-1">
          <li>SecurePayNet nunca te va a pedir tu contrasena, codigo de verificacion ni datos de tarjeta por telefono, WhatsApp o email.</li>
          <li>No compartas tu CVU con personas que no conoces para "verificar" o "validar" tu cuenta.</li>
          <li>Activa la biometria de tu dispositivo para mayor proteccion.</li>
          <li>Si detectas movimientos no reconocidos, contactanos inmediatamente desde Soporte.</li>
        </ul>
      </div>

      {msg && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 text-xs rounded-lg p-3">
          {msg}
        </div>
      )}
    </div>
  )
}
