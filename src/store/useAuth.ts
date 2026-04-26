import { create } from 'zustand'
import { supabase } from '../lib/supabase'

type Cliente = {
  id: string
  nombre: string | null
  apellido: string | null
  email: string | null
  cuit: string | null
  telefono: string | null
  tipo: string | null
  cvu: string | null
  alias: string | null
  saldo: number | null
  moneda: string | null
}

type State = {
  user: { id: string; email: string } | null
  cliente: Cliente | null
  hydrating: boolean
  hydrate: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

async function loadCliente(authUserId: string): Promise<Cliente | null> {
  try {
    const { data: cli, error: e1 } = await supabase
      .from('clientes')
      .select('id, nombre, apellido, email, cuit, telefono, tipo')
      .eq('auth_user_id', authUserId)
      .maybeSingle()
    if (e1) {
      console.error('[loadCliente] clientes error:', e1)
      return null
    }
    if (!cli) {
      console.warn('[loadCliente] no cliente found for auth_user_id', authUserId)
      return null
    }

    const { data: wal, error: e2 } = await supabase
      .from('wallets')
      .select('cvu, alias, saldo, moneda')
      .eq('cliente_id', cli.id)
      .maybeSingle()
    if (e2) console.error('[loadCliente] wallets error:', e2)

    return {
      id: cli.id,
      nombre: cli.nombre,
      apellido: cli.apellido,
      email: cli.email,
      cuit: cli.cuit,
      telefono: cli.telefono,
      tipo: cli.tipo,
      cvu: wal?.cvu ?? null,
      alias: wal?.alias ?? null,
      saldo: wal?.saldo ?? null,
      moneda: wal?.moneda ?? null,
    }
  } catch (err) {
    console.error('[loadCliente] exception:', err)
    return null
  }
}

export const useAuth = create<State>((set) => ({
  user: null,
  cliente: null,
  hydrating: true,
  hydrate: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        set({ user: null, cliente: null, hydrating: false })
        return
      }
      const cliente = await loadCliente(session.user.id)
      set({
        user: { id: session.user.id, email: session.user.email ?? '' },
        cliente,
        hydrating: false,
      })
    } catch (err) {
      console.error('[hydrate] error:', err)
      set({ hydrating: false })
    }
  },
  signIn: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }
    if (data.user) {
      const cliente = await loadCliente(data.user.id)
      set({
        user: { id: data.user.id, email: data.user.email ?? '' },
        cliente,
      })
    }
    return { error: null }
  },
  signOut: async () => {
    await supabase.auth.signOut()
    set({ user: null, cliente: null })
  },
}))

// Listener de cambios de sesión - NO bloquea hydrate
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' || !session?.user) {
    useAuth.setState({ user: null, cliente: null })
    return
  }
  // Solo recargar cliente en eventos de signin (no en INITIAL_SESSION para evitar duplicar trabajo)
  if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
    loadCliente(session.user.id).then((cliente) => {
      useAuth.setState({
        user: { id: session.user.id, email: session.user.email ?? '' },
        cliente,
      })
    })
  }
})