import { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { api } from "@/lib/api";
import { rupiah } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp, Wallet, ShoppingCart, AlertTriangle, MessageCircle } from "lucide-react";
import { toast } from "sonner";

export default function Dashboard() {
  const { store } = useAuth();
  const [data, setData] = useState(null);

  const load = async () => {
    const r = await api.get("/reports/summary");
    setData(r.data);
  };
  useEffect(() => { load(); }, []);

  const sendReport = () => {
    if (!store?.owner_wa) {
      toast.error("Nomor WA pemilik belum diatur. Isi di Pengaturan.");
      return;
    }
    const t = data.today;
    const low = data.low_stock;
    const text = [
      `*Laporan Tutup Toko - ${store.shop_name || "Toko"}*`,
      `Tanggal: ${new Date().toLocaleDateString("id-ID")}`,
      ``,
      `Total Penjualan: ${rupiah(t.total)}`,
      `- Tunai: ${rupiah(t.cash_total)}`,
      `- QRIS: ${rupiah(t.qris_total)}`,
      `Jumlah Transaksi: ${t.count}`,
      `Estimasi Profit: ${rupiah(t.profit)}`,
      ``,
      `Stok Menipis (${low.length}):`,
      ...low.slice(0, 15).map((p) => `- ${p.name}: ${p.stock} ${p.unit}`),
    ].join("\n");
    const wa = store.owner_wa.replace(/\D/g, "");
    window.open(`https://wa.me/${wa}?text=${encodeURIComponent(text)}`, "_blank");
  };

  if (!data) return <DashboardLayout title="Dashboard">Memuat...</DashboardLayout>;
  const t = data.today, w = data.week;

  return (
    <DashboardLayout title="Dashboard">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="text-slate-500">Ringkasan penjualan hari ini & 7 hari terakhir</div>
        <Button
          onClick={sendReport}
          data-testid="btn-tutup-toko"
          className="min-h-[56px] rounded-xl px-6 text-lg font-bold bg-emerald-600 hover:bg-emerald-700 active:scale-95 transition-transform text-white"
        >
          <MessageCircle className="w-5 h-5 mr-2" />
          Tutup Toko & Kirim ke WA
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Penjualan Hari Ini" value={rupiah(t.total)} icon={Wallet} color="emerald" testid="stat-today-total" />
        <StatCard label="Transaksi Hari Ini" value={t.count} icon={ShoppingCart} color="blue" testid="stat-today-count" />
        <StatCard label="Estimasi Profit Hari Ini" value={rupiah(t.profit)} icon={TrendingUp} color="emerald" testid="stat-today-profit" />
        <StatCard label="Penjualan 7 Hari" value={rupiah(w.total)} icon={TrendingUp} color="blue" testid="stat-week-total" />
      </div>

      <Card className="p-6 mb-6 rounded-2xl border-slate-200">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-xl font-bold">Penjualan 7 Hari Terakhir</h3>
          <span className="text-xs tracking-[0.2em] uppercase font-semibold text-slate-500">Total {rupiah(w.total)}</span>
        </div>
        <div className="h-64" data-testid="chart-week">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#16A34A" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#16A34A" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tickLine={false} axisLine={false} stroke="#94A3B8" />
              <YAxis tickLine={false} axisLine={false} stroke="#94A3B8" tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)} />
              <Tooltip formatter={(v) => rupiah(v)} contentStyle={{ borderRadius: 12, border: "1px solid #E2E8F0" }} />
              <Area dataKey="total" stroke="#16A34A" strokeWidth={3} fill="url(#g)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-6 rounded-2xl border-slate-200">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-xl font-bold flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
            Stok Menipis
          </h3>
          <span className="text-sm text-slate-500">{data.low_stock.length} produk</span>
        </div>
        {data.low_stock.length === 0 ? (
          <p className="text-slate-500">Semua stok aman.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="low-stock-list">
            {data.low_stock.map((p) => (
              <div key={p.id} className="p-4 rounded-xl border border-orange-200 bg-orange-50 flex items-center justify-between">
                <div>
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-xs text-slate-500">Ambang: {p.low_stock_threshold} {p.unit}</div>
                </div>
                <div className="text-orange-700 font-bold">{p.stock} {p.unit}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </DashboardLayout>
  );
}

function StatCard({ label, value, icon: Icon, color, testid }) {
  const bg = color === "emerald" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700";
  return (
    <Card className="p-6 rounded-2xl border-slate-200 hover:-translate-y-1 hover:shadow-md transition-transform" data-testid={testid}>
      <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center mb-4`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="text-xs tracking-[0.2em] uppercase font-semibold text-slate-500 mb-1">{label}</div>
      <div className="font-display text-3xl font-black tracking-tight">{value}</div>
    </Card>
  );
}
