import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "@/components/DashboardLayout";
import { api } from "@/lib/api";
import { rupiah, formatDateTime } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Printer, ArrowLeft, Receipt, CloudUpload, WifiOff, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { printReceipt, isBluetoothSupported } from "@/lib/thermal-printer";
import { getPending, syncPending, isOnline } from "@/lib/offline";

export default function History() {
  const { user, store } = useAuth();
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [pending, setPending] = useState([]);
  const [selected, setSelected] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const ownerId = user?.owner_id;

  const load = async () => {
    if (ownerId) setPending(await getPending(ownerId));
    if (isOnline()) {
      try {
        const r = await api.get("/transactions", { params: { limit: 100 } });
        setItems(r.data);
      } catch (e) { /* offline — leave items */ }
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [ownerId]);

  const reprint = async (t) => {
    try {
      await printReceipt({ store, txn: t, kasirName: t.cashier_name || user.name });
      toast.success("Struk tercetak");
    } catch (err) {
      toast.error(err.message || "Gagal cetak");
    }
  };

  const reprintPending = async (p) => {
    const txn = {
      ...p.payload,
      created_at: p.created_at,
      cashier_name: p.cashier_name || user.name,
    };
    await reprint(txn);
  };

  const doSync = async () => {
    if (!ownerId || !isOnline()) { toast.error("Sedang offline"); return; }
    setSyncing(true);
    const r = await syncPending(ownerId);
    setSyncing(false);
    if (r.synced > 0) toast.success(`${r.synced} transaksi tersinkron`);
    if (r.failed > 0) toast.error(`${r.failed} gagal disinkron`);
    load();
  };

  const isCashier = user?.role === "cashier";
  const content = (
    <>
      {pending.length > 0 && (
        <Card className="p-5 rounded-2xl border-orange-200 bg-orange-50/60 mb-5" data-testid="pending-section">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <WifiOff className="w-5 h-5 text-orange-600" />
              <h3 className="font-display font-bold text-orange-800">
                Antrean Offline ({pending.length})
              </h3>
            </div>
            <Button
              size="sm" variant="outline" onClick={doSync}
              disabled={syncing || !isOnline()} data-testid="sync-now"
              className="rounded-xl border-orange-300 text-orange-800 font-semibold"
            >
              {syncing ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <CloudUpload className="w-4 h-4 mr-2" />}
              Sinkron Sekarang
            </Button>
          </div>
          <div className="space-y-2">
            {pending.map((p) => (
              <div key={p.local_id} className="flex items-center gap-3 bg-white/80 border border-orange-200 rounded-xl p-3" data-testid={`pending-${p.local_id}`}>
                <div className="w-9 h-9 rounded-lg bg-orange-100 text-orange-700 flex items-center justify-center">
                  <Receipt className="w-4 h-4" />
                </div>
                <button onClick={() => setSelected({ ...p.payload, _pending: p })} className="flex-1 text-left">
                  <div className="font-bold">{rupiah(p.payload.total)}</div>
                  <div className="text-xs text-slate-500">
                    {formatDateTime(p.created_at)} · {p.payload.items.length} item · {p.payload.payment_method.toUpperCase()} · {p.cashier_name || "-"}
                  </div>
                </button>
                <Button
                  variant="outline" size="sm"
                  onClick={() => reprintPending(p)}
                  disabled={!isBluetoothSupported()}
                  data-testid={`reprint-pending-${p.local_id}`}
                  className="rounded-xl border-orange-300"
                >
                  <Printer className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
      {items.length === 0 && pending.length === 0 ? (
        <p className="text-slate-500">Belum ada transaksi</p>
      ) : (
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
      )}

      <Dialog open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <DialogContent className="rounded-2xl max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display text-2xl font-black">Detail Transaksi</DialogTitle></DialogHeader>
          {selected && (
            <div>
              {selected._pending && (
                <div className="mb-3 inline-flex items-center gap-2 text-xs font-semibold text-orange-700 bg-orange-100 rounded-full px-3 py-1">
                  <WifiOff className="w-3 h-3" /> Antrean offline
                </div>
              )}
              <div className="text-xs text-slate-500 mb-4">
                {formatDateTime(selected.created_at || selected._pending?.created_at)} · Kasir: {selected.cashier_name || selected._pending?.cashier_name}
              </div>
              <div className="space-y-2 mb-4">
                {selected.items.map((it, i) => (
                  <div key={`${it.product_id}-${i}`} className="flex justify-between">
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
              <Button
                onClick={() => selected._pending ? reprintPending(selected._pending) : reprint(selected)}
                disabled={!isBluetoothSupported()}
                data-testid="detail-reprint"
                className="w-full mt-4 min-h-[56px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold"
              >
                <Printer className="w-5 h-5 mr-2" /> Cetak Ulang
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );

  if (isCashier) {
    return (
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="flex items-center gap-2 mb-4">
          <Button variant="outline" size="icon" onClick={() => nav("/pos")} data-testid="back-pos"><ArrowLeft className="w-4 h-4" /></Button>
          <h1 className="font-display text-2xl font-black">Riwayat</h1>
        </div>
        {content}
      </div>
    );
  }

  return <DashboardLayout title="Riwayat Transaksi">{content}</DashboardLayout>;
}
