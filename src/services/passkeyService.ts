// src/services/passkeyService.ts
import { supabase } from '../lib/supabase'
import {
  isWebAuthnSupported,
  registerCredential,
  authenticateCredential,
  detectDeviceName,
} from '../lib/webauthn'

export type Passkey = {
  id: string
  user_id: string
  credential_id: string
  transports: string[] | null
  device_name: string | null
  created_at: string
  last_used_at: string | null
}

export const passkeyService = {
  isWebAuthnSupported,

  async list(): Promise<Passkey[]> {
    const { data, error } = await supabase
      .from('user_passkeys')
      .select('id, user_id, credential_id, transports, device_name, created_at, last_used_at')
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []) as Passkey[]
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('user_passkeys').delete().eq('id', id)
    if (error) throw error
  },

  async registerCurrentDevice(deviceName?: string): Promise<void> {
    const { data: begin, error: e1 } = await supabase.functions.invoke('passkey-register-begin', { body: {} })
    if (e1 || !begin?.ok) throw new Error(e1?.message ?? begin?.message ?? 'Error al iniciar registro')

    const credential = await registerCredential(begin.options)

    const { data: finish, error: e2 } = await supabase.functions.invoke('passkey-register-finish', {
      body: { credential, deviceName: deviceName ?? detectDeviceName() },
    })
    if (e2 || !finish?.ok) throw new Error(e2?.message ?? finish?.message ?? 'Error al finalizar registro')
  },

  async authenticate(): Promise<{ gateToken: string }> {
    const { data: begin, error: e1 } = await supabase.functions.invoke('passkey-auth-begin', { body: {} })
    if (e1) throw new Error(e1.message)
    if (!begin?.ok) throw new Error(begin?.code === 'NO_PASSKEYS' ? 'NO_PASSKEYS' : (begin?.message ?? 'Error'))

    const credential = await authenticateCredential(begin.options)

    const { data: finish, error: e2 } = await supabase.functions.invoke('passkey-auth-finish', {
      body: { credential },
    })
    if (e2 || !finish?.ok) {
      const code = finish?.code ?? 'AUTH_FAILED'
      throw new Error(code === 'CLONED_CREDENTIAL' ? 'CLONED_CREDENTIAL' : (e2?.message ?? finish?.message ?? 'Auth fallido'))
    }
    return { gateToken: finish.gateToken }
  },

  async authenticateWithPassword(password: string): Promise<{ gateToken: string }> {
    const { data, error } = await supabase.functions.invoke('gate-password', { body: { password } })
    if (error || !data?.ok) {
      const code = data?.code ?? 'AUTH_FAILED'
      if (code === 'RATE_LIMITED') throw new Error('RATE_LIMITED')
      throw new Error(error?.message ?? data?.message ?? 'Contrasena incorrecta')
    }
    return { gateToken: data.gateToken }
  },

  async loginBegin(email: string): Promise<{ options: any }> {
    const { data, error } = await supabase.functions.invoke('passkey-login-begin', { body: { email } })
    if (error || !data?.ok) throw new Error(error?.message ?? data?.message ?? 'Login begin failed')
    return { options: data.options }
  },

  async loginFinish(email: string, credential: any): Promise<{ hashedToken: string }> {
    const { data, error } = await supabase.functions.invoke('passkey-login-finish', {
      body: { email, credential },
    })
    if (error || !data?.ok) {
      const code = data?.code ?? 'AUTH_FAILED'
      if (code === 'CLONED_CREDENTIAL') throw new Error('CLONED_CREDENTIAL')
      throw new Error(error?.message ?? data?.message ?? 'Auth failed')
    }
    return { hashedToken: data.hashed_token }
  },
}
