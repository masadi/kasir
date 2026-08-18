import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "@/components/DashboardLayout";
import { api } from "@/lib/api";
import { rupiah, formatDateTime } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Printer, ArrowLeft, Receipt } from "lucide-react";
import { toast } from "sonner";
import { printReceipt, isBluetoothSupported } from "@/lib/thermal-printer";

export default function History() {
  const { user, store } = useAuth();
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);

  const load = async () => setItems((await api.get("/transactions", { params: { limit: 100 } })).data);
  useEffect(() => { load(); }, []);

  const reprint = async (t) => {
    try {
      await printReceipt({ store, txn: t, kasirName: t.cashier_name || user.name });
      toast.success("Struk tercetak");
    } catch (err) {
      toast.error(err.message || "Gagal cetak");
    }
  };

  // Cashier layout differs — no sidebar
  if (user?.role === "cashier") {
    return (
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="flex items-center gap-2 mb-4">
          <Button variant="outline" size="icon" onClick={() => nav("/pos")} data-testid="back-pos"><ArrowLeft className="w-4 h-4" /></Button>
          <h1 className="font-display text-2xl font-black">Riwayat</h1>
        </div>
        {renderList(items, setSelected, reprint)}
        {renderDetail(selected, setSelected, reprint)}
      </div>
    );
  }

  return (
    <DashboardLayout title="Riwayat Transaksi">
      {renderList(items, setSelected, reprint)}
      {renderDetail(selected, setSelected, reprint)}
    </DashboardLayout>
  );
}

function renderList(items, setSelected, reprint) {
  if (items.length === 0) return <p className="text-slate-500">Belum ada transaksi</p>;
  return (
    <div className="space-y-3" data-testid="txn-list">
      {items.map((t) => (
        <Card key={t.id} className="p-4 rounded-2xl border-slate-200 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <Receipt className="w-5 h-5" />
          </div>
          <button onClick={() => setSelected(t)} className="flex-1 text-left" data-testid={`txn-${t.id}`}>
            <div className="font-bold">{rupiah(t.total)}</div>
            <div className="text-xs text-slate-500">
              {formatDateTime(t.created_at)} · {t.items.length} item · {t.payment_method.toUpperCase()} · {t.cashier_name}
            </div>
          </button>
          <Button variant="outline" size="sm" onClick={() => reprint(t)} disabled={!isBluetoothSupported()} data-testid={`reprint-${t.id}`}>
            <Printer className="w-4 h-4" />
          </Button>
        </Card>
      ))}
    </div>
  );
}

function renderDetail(selected, setSelected, reprint) {
  return (
    <Dialog open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
      <DialogContent className="rounded-2xl max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display text-2xl font-black">Detail Transaksi</DialogTitle></DialogHeader>
        {selected && (
          <div>
            <div className="text-xs text-slate-500 mb-4">
              {formatDateTime(selected.created_at)} · Kasir: {selected.cashier_name}
            </div>
            <div className="space-y-2 mb-4">
              {selected.items.map((it, i) => (
                <div key={i} className="flex justify-between">
                  <span>{it.name} × {it.qty} {it.unit}</span>
                  <span className="font-semibold">{rupiah(it.subtotal)}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-slate-200 pt-3 space-y-1">
              <div className="flex justify-between font-bold text-lg"><span>Total</span><span className="text-emerald-700">{rupiah(selected.total)}</span></div>
              {selected.payment_method === "cash" && (
                <>
                  <div className="flex justify-between text-slate-500 text-sm"><span>Tunai</span><span>{rupiah(selected.cash_received)}</span></div>
                  <div className="flex justify-between text-slate-500 text-sm"><span>Kembali</span><span>{rupiah(selected.change)}</span></div>
                </>
              )}
              {selected.payment_method === "qris" && <div className="text-slate-500 text-sm">Bayar: QRIS</div>}
            </div>
            <Button onClick={() => reprint(selected)} disabled={!isBluetoothSupported()} data-testid="detail-reprint" className="w-full mt-4 min-h-[56px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold">
              <Printer className="w-5 h-5 mr-2" /> Cetak Ulang
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
