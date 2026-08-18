import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api, fileUrl, formatApiError } from "@/lib/api";
import { rupiah } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, Plus, Minus, Trash2, ShoppingCart, Printer, LogOut, History as HistoryIcon, X, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { printReceipt, isBluetoothSupported } from "@/lib/thermal-printer";
import OfflineIndicator from "@/components/OfflineIndicator";
import {
  isOnline,
  cacheProducts,
  getCachedProducts,
  updateCachedStock,
  queueTxn,
  syncPending,
} from "@/lib/offline";

export default function POS() {
  const { user, store, logout } = useAuth();
  const nav = useNavigate();
  const ownerId = user?.owner_id;
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("Semua");
  const [showCart, setShowCart] = useState(false);
  const [qtyModal, setQtyModal] = useState(null);
  const [qtyInput, setQtyInput] = useState("");
  const [showPay, setShowPay] = useState(false);
  const [payMethod, setPayMethod] = useState("cash");
  const [cash, setCash] = useState("");
  const [lastTxn, setLastTxn] = useState(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const load = async () => {
    if (!ownerId) return;
    // Try server first; fall back to IDB cache if offline/error
    try {
      const r = await api.get("/products");
      setProducts(r.data);
      await cacheProducts(ownerId, r.data);
    } catch (e) {
      const cached = await getCachedProducts(ownerId);
      setProducts(cached);
      if (!isOnline()) toast.info("Mode offline — memakai data tersimpan");
    }
  };

  useEffect(() => {
    load();
    // Try to drain any pending queue on mount
    if (ownerId && isOnline()) {
      syncPending(ownerId).then((r) => {
        if (r && r.synced > 0) {
          toast.success(`${r.synced} transaksi tersinkron`);
          load();
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);

  const categories = useMemo(() => {
    const s = new Set(["Semua"]);
    products.forEach((p) => s.add(p.category || "Umum"));
    return Array.from(s);
  }, [products]);

  const filtered = products.filter((p) => {
    const okCat = cat === "Semua" || p.category === cat;
    const okS = !search || p.name.toLowerCase().includes(search.toLowerCase());
    return okCat && okS;
  });

  const total = cart.reduce((s, i) => s + i.subtotal, 0);

  const addProduct = (p) => {
    if (p.unit === "kg" || p.unit === "ons") {
      setQtyModal(p); setQtyInput(""); return;
    }
    const existing = cart.find((i) => i.product_id === p.id);
    if (existing) {
      setCart(cart.map((i) => i.product_id === p.id ? { ...i, qty: i.qty + 1, subtotal: (i.qty + 1) * i.price } : i));
    } else {
      setCart([...cart, { product_id: p.id, name: p.name, unit: p.unit, qty: 1, price: p.price, subtotal: p.price }]);
    }
  };

  const confirmQty = () => {
    const q = parseFloat(qtyInput);
    if (!q || q <= 0) { toast.error("Qty tidak valid"); return; }
    const p = qtyModal;
    const price = p.price * q;
    const existing = cart.find((i) => i.product_id === p.id);
    if (existing) {
      setCart(cart.map((i) => i.product_id === p.id ? { ...i, qty: i.qty + q, subtotal: (i.qty + q) * p.price } : i));
    } else {
      setCart([...cart, { product_id: p.id, name: p.name, unit: p.unit, qty: q, price: p.price, subtotal: price }]);
    }
    setQtyModal(null);
  };

  const changeQty = (cartId, delta) => {
    const items = [...cart];
    const idx = items.findIndex((x) => x.product_id === cartId);
    if (idx < 0) return;
    const it = items[idx];
    const step = (it.unit === "kg" || it.unit === "ons") ? 0.5 : 1;
    const newQ = Math.max(0, +(it.qty + delta * step).toFixed(3));
    if (newQ === 0) items.splice(idx, 1);
    else { it.qty = newQ; it.subtotal = newQ * it.price; }
    setCart(items);
  };
  const removeItem = (cartId) => setCart(cart.filter((x) => x.product_id !== cartId));

  const openPay = () => {
    if (cart.length === 0) { toast.error("Keranjang kosong"); return; }
    setPayMethod("cash"); setCash(""); setShowPay(true);
  };

  const submitPay = async () => {
    let cashReceived = null, change = null;
    if (payMethod === "cash") {
      const c = parseFloat(cash);
      if (!c || c < total) { toast.error("Uang diterima kurang"); return; }
      cashReceived = c; change = c - total;
    }
    const payload = { items: cart, total, payment_method: payMethod, cash_received: cashReceived, change };

    // Online path — POST direct
    if (isOnline()) {
      try {
        const r = await api.post("/transactions", payload);
        setLastTxn(r.data);
        setShowPay(false);
        setCart([]);
        setShowSuccess(true);
        load();
        return;
      } catch (e) {
        // Fall through to offline queue if network error
        if (!e.response) {
          toast.warning("Server tidak terjangkau — disimpan di antrean");
        } else {
          toast.error(formatApiError(e.response?.data?.detail) || "Gagal simpan");
          return;
        }
      }
    }

    // Offline / fallback path — queue + local stock decrement
    await queueTxn(ownerId, payload);
    await updateCachedStock(ownerId, cart);
    const cached = await getCachedProducts(ownerId);
    setProducts(cached);
    const localTxn = {
      ...payload,
      id: null,
      cashier_name: user?.name,
      created_at: new Date().toISOString(),
      _offline: true,
    };
    setLastTxn(localTxn);
    setShowPay(false);
    setCart([]);
    setShowSuccess(true);
    toast.info("Tersimpan offline — akan sinkron saat online");
  };

  const doPrint = async () => {
    if (!lastTxn) return;
    try {
      await printReceipt({ store, txn: lastTxn, kasirName: user.name });
      toast.success("Struk tercetak");
    } catch (err) {
      toast.error(err.message || "Gagal cetak");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <OfflineIndicator />
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2 mb-3">
          <div>
            <div className="font-display font-black text-lg leading-tight">{store?.shop_name || "Toko"}</div>
            <div className="text-xs text-slate-500">Kasir: {user?.name}</div>
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="icon" onClick={() => nav("/history")} data-testid="pos-history">
              <HistoryIcon className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={logout} data-testid="pos-logout">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div className="relative">
          <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            data-testid="pos-search"
            placeholder="Cari produk..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="pl-10 min-h-[52px] rounded-xl border-2"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar pt-3 pb-1">
          {categories.map((c) => (
            <button key={c} data-testid={`cat-${c}`} onClick={() => setCat(c)}
              className={`px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${cat === c ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}>
              {c}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 p-3 pb-28">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" data-testid="pos-grid">
          {filtered.map((p) => (
            <button
              key={p.id} data-testid={`pos-product-${p.id}`}
              onClick={() => addProduct(p)}
              className="fade-up bg-white rounded-2xl p-4 border border-slate-200 text-left hover:-translate-y-1 hover:shadow-md transition-transform active:scale-95"
            >
              <div className="aspect-square rounded-xl bg-slate-100 flex items-center justify-center overflow-hidden mb-3">
                {p.image_path ? (
                  <img src={fileUrl(p.image_path)} alt={p.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="font-display font-black text-3xl text-slate-400">{p.name[0]?.toUpperCase()}</span>
                )}
              </div>
              <div className="font-semibold text-sm line-clamp-2">{p.name}</div>
              <div className="text-emerald-600 font-bold mt-1">{rupiah(p.price)}</div>
              <div className={`text-xs mt-1 ${p.stock <= p.low_stock_threshold ? "text-orange-600" : "text-slate-500"}`}>Stok: {p.stock} {p.unit}</div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full text-center text-slate-500 py-12">Tidak ada produk</div>
          )}
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-3 z-30">
        <div className="flex items-center gap-3">
          <button onClick={() => setShowCart(true)} data-testid="pos-open-cart" className="relative w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
            <ShoppingCart className="w-6 h-6" />
            {cart.length > 0 && <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center font-bold">{cart.length}</span>}
          </button>
          <div className="flex-1">
            <div className="text-xs text-slate-500 font-semibold tracking-wider">TOTAL</div>
            <div className="font-display font-black text-2xl">{rupiah(total)}</div>
          </div>
          <Button
            onClick={openPay} data-testid="pos-bayar"
            disabled={cart.length === 0}
            className="min-h-[56px] rounded-xl px-8 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-bold text-lg active:scale-95 transition-transform"
          >
            Bayar
          </Button>
        </div>
      </div>

      <Dialog open={showCart} onOpenChange={setShowCart}>
        <DialogContent className="max-w-md rounded-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display text-2xl font-black">Keranjang</DialogTitle></DialogHeader>
          {cart.length === 0 ? (
            <p className="text-slate-500 py-8 text-center">Keranjang kosong</p>
          ) : (
            <div className="space-y-3">
              {cart.map((it) => (
                <div key={it.product_id} className="p-4 rounded-xl border border-slate-200" data-testid={`cart-item-${it.product_id}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="font-semibold">{it.name}</div>
                      <div className="text-xs text-slate-500">{rupiah(it.price)} / {it.unit}</div>
                    </div>
                    <button onClick={() => removeItem(it.product_id)} className="text-red-500"><Trash2 className="w-4 h-4" /></button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Button size="icon" variant="outline" onClick={() => changeQty(it.product_id, -1)} className="w-10 h-10 rounded-xl"><Minus className="w-4 h-4" /></Button>
                      <span className="font-bold min-w-[60px] text-center">{it.qty} {it.unit}</span>
                      <Button size="icon" variant="outline" onClick={() => changeQty(it.product_id, +1)} className="w-10 h-10 rounded-xl"><Plus className="w-4 h-4" /></Button>
                    </div>
                    <span className="font-bold text-emerald-700">{rupiah(it.subtotal)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button className="w-full min-h-[56px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold" onClick={() => { setShowCart(false); openPay(); }} disabled={cart.length === 0} data-testid="cart-checkout">
              Bayar {rupiah(total)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!qtyModal} onOpenChange={(v) => !v && setQtyModal(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle className="font-display text-2xl font-black">{qtyModal?.name}</DialogTitle></DialogHeader>
          <div>
            <div className="text-sm text-slate-500 mb-2">Masukkan jumlah dalam <b>{qtyModal?.unit}</b></div>
            <Input data-testid="qty-input" type="number" step="0.1" autoFocus value={qtyInput} onChange={(e) => setQtyInput(e.target.value)}
              className="min-h-[64px] rounded-xl border-2 text-2xl font-bold text-center" />
            <div className="text-slate-500 mt-2 text-center">Subtotal: {rupiah((parseFloat(qtyInput) || 0) * (qtyModal?.price || 0))}</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQtyModal(null)} className="min-h-[52px] rounded-xl">Batal</Button>
            <Button data-testid="qty-confirm" onClick={confirmQty} className="min-h-[52px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold">Tambah</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showPay} onOpenChange={setShowPay}>
        <DialogContent className="rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display text-2xl font-black">Pembayaran</DialogTitle></DialogHeader>
          <div className="text-center mb-4">
            <div className="text-xs tracking-[0.2em] uppercase font-semibold text-slate-500">Total</div>
            <div className="font-display text-5xl font-black text-emerald-700">{rupiah(total)}</div>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <button data-testid="pay-cash" onClick={() => setPayMethod("cash")} className={`p-4 rounded-xl border-2 font-bold ${payMethod === "cash" ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-slate-200"}`}>Tunai</button>
            <button data-testid="pay-qris" onClick={() => setPayMethod("qris")} disabled={!store?.qris_image_path} className={`p-4 rounded-xl border-2 font-bold disabled:opacity-40 ${payMethod === "qris" ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200"}`}>QRIS</button>
          </div>
          {payMethod === "cash" ? (
            <div>
              <div className="text-sm text-slate-500 mb-2">Uang diterima</div>
              <Input data-testid="cash-input" type="number" value={cash} onChange={(e) => setCash(e.target.value)} autoFocus
                className="min-h-[64px] rounded-xl border-2 text-2xl font-bold text-center" />
              <div className="flex gap-2 mt-3 flex-wrap">
                {[total, Math.ceil(total / 5000) * 5000, Math.ceil(total / 10000) * 10000, Math.ceil(total / 50000) * 50000].map((n) => (
                  <button key={`cash-${n}`} onClick={() => setCash(String(n))} className="px-3 py-2 rounded-lg bg-slate-100 text-sm font-semibold hover:bg-slate-200">{rupiah(n)}</button>
                ))}
              </div>
              {cash && parseFloat(cash) >= total && (
                <div className="mt-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                  <div className="text-xs text-emerald-700 font-semibold">KEMBALIAN</div>
                  <div className="font-display text-3xl font-black text-emerald-700">{rupiah(parseFloat(cash) - total)}</div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center">
              {store?.qris_image_path ? (
                <img src={fileUrl(store.qris_image_path)} alt="QRIS" className="mx-auto max-w-xs rounded-xl border border-slate-200" data-testid="qris-show" />
              ) : (
                <p className="text-slate-500">QRIS belum diunggah</p>
              )}
              <p className="text-sm text-slate-500 mt-3">Minta pembeli scan lalu konfirmasi setelah lunas</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPay(false)} className="min-h-[56px] rounded-xl">Batal</Button>
            <Button data-testid="pay-confirm" onClick={submitPay} className="min-h-[56px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold">Sudah Dibayar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSuccess} onOpenChange={setShowSuccess}>
        <DialogContent className="rounded-2xl text-center">
          <DialogHeader><DialogTitle className="font-display text-2xl font-black">Transaksi Berhasil</DialogTitle></DialogHeader>
          <div className="my-4">
            <div className="text-xs tracking-[0.2em] uppercase font-semibold text-slate-500">Total</div>
            <div className="font-display text-4xl font-black text-emerald-700">{rupiah(lastTxn?.total || 0)}</div>
            {lastTxn?.payment_method === "cash" && (
              <div className="mt-2 text-slate-500">Kembalian: <b className="text-emerald-700">{rupiah(lastTxn.change || 0)}</b></div>
            )}
            {lastTxn?._offline && (
              <div className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-orange-700 bg-orange-100 rounded-full px-3 py-1">
                <WifiOff className="w-3 h-3" /> Tersimpan offline · Sinkron nanti
              </div>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <Button onClick={doPrint} disabled={!isBluetoothSupported()} data-testid="btn-print" className="min-h-[56px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold">
              <Printer className="w-5 h-5 mr-2" /> Cetak Struk
            </Button>
            <Button variant="outline" onClick={() => setShowSuccess(false)} data-testid="btn-close-success" className="min-h-[56px] rounded-xl">
              <X className="w-5 h-5 mr-2" /> Selesai
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
