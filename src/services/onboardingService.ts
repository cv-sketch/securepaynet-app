// src/services/onboardingService.ts
import { supabase } from '../lib/supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export type OnboardingResult = {
  ok: boolean
  cliente_id?: string
  wallet?: {
    cvu: string | null
    alias: string | null
    saldo: number | null
    moneda: string | null
  }
  created?: boolean
  message?: string
}

export const onboardingService = {
  signUpWithEmail: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    // Supabase no devuelve error si el email ya existe (anti-enumeration);
    // la señal es identities=[]. Detectarlo aca evita un OTP fantasma.
    if (data.user && (data.user.identities?.length ?? 0) === 0) {
      const e = new Error('USER_ALREADY_EXISTS') as Error & { code?: string }
      e.code = 'USER_ALREADY_EXISTS'
      throw e
    }
    return data
  },

  verifyEmailOtp: async (email: string, code: string) => {
    const { data, error } = await supabase.auth.verifyOtp({
      email, token: code, type: 'email',
    })
    if (error) throw error
    return data
  },

  resendEmailOtp: async (email: string) => {
    const { error } = await supabase.auth.resend({ type: 'signup', email })
    if (error) throw error
  },

  signInWithGoogle: async (redirectTo: string) => {
    // SEGURIDAD CRITICA: prompt=select_account fuerza a Google a mostrar el
    // account chooser cada vez. Sin esto, Google reusa silenciosamente la
    // sesion de Google activa en el browser, lo que permite landearse en
    // una cuenta que NO es la que el usuario queria autenticar.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: { prompt: 'select_account' },
      },
    })
    if (error) throw error
  },

  completeOnboarding: async (): Promise<OnboardingResult> => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('No active session')
    const res = await fetch(`${SUPABASE_URL}/functions/v1/onboarding-complete`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
    })
    const json = (await res.json()) as OnboardingResult
    if (!json.ok) throw new Error(json.message ?? 'Onboarding failed')
    return json
  },
}
