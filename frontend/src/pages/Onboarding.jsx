import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api, fileUrl, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Store, Upload, Bluetooth, Package, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { connectPrinter, isBluetoothSupported, getPrinterName } from "@/lib/thermal-printer";

const STEPS = [
  { title: "Info Toko", icon: Store },
  { title: "Upload QRIS", icon: Upload },
  { title: "Pairing Printer", icon: Bluetooth },
  { title: "Produk Pertama", icon: Package },
];

export default function Onboarding() {
  const { store, refreshStore } = useAuth();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [info, setInfo] = useState({
    shop_name: store?.shop_name || "",
    address: store?.address || "",
    owner_wa: store?.owner_wa || "",
  });
  const [qrisPath, setQrisPath] = useState(store?.qris_image_path || null);
  const [printerName, setPrinterName] = useState(getPrinterName());
  const [firstProd, setFirstProd] = useState({ name: "", price: "", stock: "1", unit: "pcs" });
  const [busy, setBusy] = useState(false);

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  const saveInfo = async () => {
    setBusy(true);
    try { await api.put("/store", info); await refreshStore(); next(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  const uploadQris = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", f);
      const r = await api.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      await api.put("/store", { qris_image_path: r.data.path });
      setQrisPath(r.data.path);
      await refreshStore();
      toast.success("QRIS terunggah");
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
    finally { setBusy(false); e.target.value = ""; }
  };

  const pair = async () => {
    try {
      const n = await connectPrinter();
      setPrinterName(n);
      toast.success(`Terhubung: ${n}`);
    } catch (err) { toast.error(err.message); }
  };

  const finish = async () => {
    setBusy(true);
    try {
      if (firstProd.name && firstProd.price) {
        await api.post("/products", {
          name: firstProd.name,
          price: Number(firstProd.price),
          stock: Number(firstProd.stock || 0),
          unit: firstProd.unit,
          hpp: 0, low_stock_threshold: 5, category: "Umum"
        });
      }
      await api.post("/store/complete-onboarding");
      await refreshStore();
      toast.success("Setup selesai!");
      nav("/dashboard");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        <div className="flex items-center gap-3 mb-8">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center flex-1">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${i <= step ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-400"}`}>
                {i < step ? <CheckCircle2 className="w-5 h-5" /> : i + 1}
              </div>
              {i < STEPS.length - 1 && <div className={`flex-1 h-1 mx-2 rounded ${i < step ? "bg-blue-600" : "bg-slate-200"}`} />}
            </div>
          ))}
        </div>

        <Card className="p-8 rounded-3xl border-slate-200">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-700 flex items-center justify-center">
              {(() => { const I = STEPS[step].icon; return <I className="w-6 h-6" />; })()}
            </div>
            <div>
              <div className="text-xs tracking-[0.2em] uppercase font-semibold text-slate-500">Langkah {step + 1} / 4</div>
              <h2 className="font-display text-2xl font-black">{STEPS[step].title}</h2>
            </div>
          </div>

          {step === 0 && (
            <div className="space-y-4" data-testid="onb-step-info">
              <div><Label>Nama Toko</Label><Input data-testid="onb-shop" value={info.shop_name} onChange={(e) => setInfo({ ...info, shop_name: e.target.value })} className="min-h-[56px] rounded-xl border-2 mt-2" /></div>
              <div><Label>Alamat</Label><Input data-testid="onb-address" value={info.address} onChange={(e) => setInfo({ ...info, address: e.target.value })} className="min-h-[56px] rounded-xl border-2 mt-2" /></div>
              <div><Label>Nomor WA Pemilik</Label><Input data-testid="onb-wa" placeholder="62812xxxx" value={info.owner_wa} onChange={(e) => setInfo({ ...info, owner_wa: e.target.value })} className="min-h-[56px] rounded-xl border-2 mt-2" /></div>
              <div className="flex justify-end pt-4">
                <Button onClick={saveInfo} disabled={busy || !info.shop_name} data-testid="onb-next-1" className="min-h-[56px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold px-8">Lanjut</Button>
              </div>
            </div>
          )}
          {step === 1 && (
            <div data-testid="onb-step-qris">
              <p className="text-slate-500 mb-4">Unggah gambar QRIS statis untuk ditampilkan ke pembeli saat bayar non-tunai.</p>
              {qrisPath && <img src={fileUrl(qrisPath)} alt="QRIS" className="w-48 rounded-xl border border-slate-200 mb-4" />}
              <label className="block mb-4">
                <input type="file" accept="image/*" className="hidden" onChange={uploadQris} data-testid="onb-qris-upload" />
                <span className="inline-flex items-center justify-center gap-2 min-h-[56px] rounded-xl px-6 bg-blue-600 hover:bg-blue-700 text-white font-bold w-full cursor-pointer">
                  <Upload className="w-5 h-5" /> {busy ? "Mengunggah..." : (qrisPath ? "Ganti Gambar" : "Unggah Gambar QRIS")}
                </span>
              </label>
              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={prev} className="min-h-[56px] rounded-xl px-8">Kembali</Button>
                <Button onClick={next} data-testid="onb-next-2" className="min-h-[56px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold px-8">{qrisPath ? "Lanjut" : "Lewati"}</Button>
              </div>
            </div>
          )}
          {step === 2 && (
            <div data-testid="onb-step-printer">
              <p className="text-slate-500 mb-4">Nyalakan printer thermal bluetooth (58mm), lalu tekan tombol Pair. Butuh Chrome di Android.</p>
              {!isBluetoothSupported() && (
                <div className="mb-4 p-4 rounded-xl bg-orange-50 border border-orange-200 text-orange-800 text-sm">
                  Web Bluetooth tidak didukung di browser ini. Kamu bisa lewati dulu dan pairing dari HP kasir nanti.
                </div>
              )}
              {printerName && <div className="mb-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-2 text-emerald-800"><CheckCircle2 className="w-5 h-5" /> Terhubung: <b>{printerName}</b></div>}
              <Button onClick={pair} disabled={!isBluetoothSupported()} data-testid="onb-pair" className="min-h-[56px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold w-full">
                <Bluetooth className="w-5 h-5 mr-2" /> Pair Printer
              </Button>
              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={prev} className="min-h-[56px] rounded-xl px-8">Kembali</Button>
                <Button onClick={next} data-testid="onb-next-3" className="min-h-[56px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold px-8">Lanjut</Button>
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="space-y-4" data-testid="onb-step-product">
              <p className="text-slate-500">Tambah produk pertama (opsional). Bisa tambah lagi nanti.</p>
              <div><Label>Nama Produk</Label><Input data-testid="onb-prod-name" value={firstProd.name} onChange={(e) => setFirstProd({ ...firstProd, name: e.target.value })} className="min-h-[56px] rounded-xl border-2 mt-2" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Harga</Label><Input data-testid="onb-prod-price" type="number" value={firstProd.price} onChange={(e) => setFirstProd({ ...firstProd, price: e.target.value })} className="min-h-[56px] rounded-xl border-2 mt-2" /></div>
                <div><Label>Stok</Label><Input data-testid="onb-prod-stock" type="number" value={firstProd.stock} onChange={(e) => setFirstProd({ ...firstProd, stock: e.target.value })} className="min-h-[56px] rounded-xl border-2 mt-2" /></div>
              </div>
              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={prev} className="min-h-[56px] rounded-xl px-8">Kembali</Button>
                <Button onClick={finish} disabled={busy} data-testid="onb-finish" className="min-h-[56px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-8">
                  {busy ? "Menyimpan..." : "Selesai & Masuk Dashboard"}
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
