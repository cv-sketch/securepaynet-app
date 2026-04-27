import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../store/useAuth";

export default function AppLayout() {
  const { user, cliente, signOut } = useAuth();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const handleSignOut = async () => {
    setMenuOpen(false);
    await signOut();
    nav("/login", { replace: true });
  };

  const initials = (cliente?.nombre || user?.email || "?")
    .trim()
    .charAt(0)
    .toUpperCase();

  const displayName =
    [cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ") ||
    user?.email ||
    "";

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="max-w-md mx-auto h-14 px-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white text-sm font-bold">
              S
            </span>
            <span className="font-semibold text-slate-800 tracking-tight">
              SecurePayNet
            </span>
          </Link>

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Menu de cuenta"
              className="flex items-center gap-2 rounded-full border border-slate-200 bg-white pl-1 pr-2 py-1 hover:bg-slate-50"
            >
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-brand-700 text-xs font-bold">
                {initials}
              </span>
              <span className="text-slate-400 text-xs">
                {menuOpen ? "▲" : "▼"}
              </span>
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-64 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-slate-100">
                  <div className="text-sm font-semibold text-slate-800 truncate">
                    {displayName}
                  </div>
                  {user?.email && displayName !== user.email && (
                    <div className="text-xs text-slate-500 truncate">
                      {user.email}
                    </div>
                  )}
                </div>
                <Link
                  to="/perfil"
                  role="menuitem"
                  className="block px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Mi perfil
                </Link>
                <Link
                  to="/seguridad"
                  role="menuitem"
                  className="block px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Seguridad
                </Link>
                <button
                  role="menuitem"
                  onClick={handleSignOut}
                  className="w-full text-left px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 border-t border-slate-100"
                >
                  Cerrar sesion
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto pb-8">
        <Outlet />
      </main>
    </div>
  );
}
