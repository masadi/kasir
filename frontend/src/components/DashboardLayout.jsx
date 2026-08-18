import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { LayoutDashboard, Package, Users, Settings as SettingsIcon, History as HistoryIcon, LogOut, Store, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";

const items = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard" },
  { to: "/products", label: "Produk", icon: Package, testid: "nav-products" },
  { to: "/history", label: "Riwayat", icon: HistoryIcon, testid: "nav-history" },
  { to: "/cashiers", label: "Kasir", icon: Users, testid: "nav-cashiers" },
  { to: "/settings", label: "Pengaturan", icon: SettingsIcon, testid: "nav-settings" },
];

export default function DashboardLayout({ children, title }) {
  const { user, store, logout } = useAuth();
  const nav = useNavigate();

  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside className="hidden md:flex md:w-64 flex-col border-r border-slate-200 bg-white p-6">
        <div className="flex items-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center">
            <Store className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-display text-lg font-black">KasirKu</div>
            <div className="text-xs text-slate-500 truncate max-w-[160px]">{store?.shop_name || "Toko"}</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1">
          {items.map((it) => (
            <NavLink
              key={it.to} to={it.to} data-testid={it.testid}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-sm transition-colors ${
                  isActive ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100"
                }`
              }
            >
              <it.icon className="w-5 h-5" />
              {it.label}
            </NavLink>
          ))}
          <button
            onClick={() => nav("/pos")}
            data-testid="nav-pos"
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-sm text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors mt-4"
          >
            <ShoppingBag className="w-5 h-5" />
            Buka Kasir
          </button>
        </nav>
        <div className="pt-4 border-t border-slate-200">
          <div className="text-sm font-semibold">{user?.name}</div>
          <div className="text-xs text-slate-500 mb-3 truncate">{user?.email}</div>
          <Button variant="outline" className="w-full min-h-[44px] rounded-xl" onClick={logout} data-testid="btn-logout">
            <LogOut className="w-4 h-4 mr-2" /> Keluar
          </Button>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <header className="md:hidden bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
              <Store className="w-4 h-4 text-white" />
            </div>
            <span className="font-display font-black">KasirKu</span>
          </div>
          <Button variant="outline" size="sm" onClick={logout} data-testid="btn-logout-m">Keluar</Button>
        </header>
        <div className="p-6 md:p-8">
          {title && <h1 className="font-display text-3xl md:text-4xl font-black tracking-tight mb-6">{title}</h1>}
          {children}
        </div>
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 grid grid-cols-5 z-40">
          {items.map((it) => (
            <NavLink
              key={it.to} to={it.to} data-testid={`m-${it.testid}`}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 py-2 text-xs font-semibold ${
                  isActive ? "text-blue-700" : "text-slate-500"
                }`
              }
            >
              <it.icon className="w-5 h-5" />
              {it.label}
            </NavLink>
          ))}
        </nav>
        <div className="md:hidden h-16" />
      </main>
    </div>
  );
}
