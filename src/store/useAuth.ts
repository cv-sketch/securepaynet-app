import { create } from 'zustand'
import { supabase } from '../lib/supabase'

type Cliente = {
  id: string
  nombre: string | null
  email: string | null
  cuit: string | null
  cvu: string | null
  alias: string | null
}

type State = {
  user: { id: string; email: string } | null
  cliente: Cliente | null
  hydrating: boolean
  hydrate: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error?: string }>
  signOut: () => Promise<void>
}

export const useAuth = create<State>((set) => ({
  user: null,
  cliente: null,
  hydrating: true,

  hydrate: async () => {
    set({ hydrating: true })
    const { data } = await supabase.auth.getSession()
    const sess = data.session
    if (sess?.user) {
      set({ user: { id: sess.user.id, email: sess.user.email ?? '' } })
      const { data: cli } = await supabase
        .from('clientes')
        .select('id, nombre, email, cuit, cvu, alias')
        .eq('auth_user_id', sess.user.id)
        .maybeSingle()
      set({ cliente: cli ?? null })
    }
    set({ hydrating: false })

    supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        set({ user: { id: session.user.id, email: session.user.email ?? '' } })
        const { data: cli } = await supabase
          .from('clientes')
          .select('id, nombre, email, cuit, cvu, alias')
          .eq('auth_user_id', session.user.id)
          .maybeSingle()
        set({ cliente: cli ?? null })
      } else {
        set({ user: null, cliente: null })
      }
    })
  },

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }
    return {}
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ user: null, cliente: null })
  },
}))
