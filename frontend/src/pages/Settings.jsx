import { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { api, fileUrl, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Bluetooth, Upload, Printer, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { connectPrinter, isBluetoothSupported, getPrinterName, buildReceipt, printBytes } from "@/lib/thermal-printer";

export default function Settings() {
  const { store, refreshStore } = useAuth();
  const [form, setForm] = useState({ shop_name: "", address: "", owner_wa: "", receipt_footer: "" });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [printerName, setPrinterName] = useState(getPrinterName());

  useEffect(() => {
    if (store) setForm({
      shop_name: store.shop_name || "",
      address: store.address || "",
      owner_wa: store.owner_wa || "",
      receipt_footer: store.receipt_footer || "Terima kasih!",
    });
  }, [store]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/store", form);
      await refreshStore();
      toast.success("Pengaturan disimpan");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setSaving(false); }
  };

  const uploadQris = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await api.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      await api.put("/store", { qris_image_path: r.data.path });
      await refreshStore();
      toast.success("QRIS diunggah");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Upload gagal");
    } finally { setUploading(false); e.target.value = ""; }
  };

  const pairPrinter = async () => {
    try {
      const name = await connectPrinter();
      setPrinterName(name);
      toast.success(`Printer terhubung: ${name}`);
    } catch (err) {
      toast.error(err.message || "Gagal pairing printer");
    }
  };

  const testPrint = async () => {
    try {
      const data = buildReceipt({
        store: form,
        txn: {
          items: [{ name: "Tes Cetak", qty: 1, unit: "pcs", subtotal: 0 }],
          total: 0, payment_method: "cash", cash_received: 0, change: 0,
          created_at: new Date().toISOString(),
        },
        kasirName: "Owner",
      });
      await printBytes(data);
      toast.success("Struk uji tercetak");
    } catch (err) {
      toast.error(err.message || "Gagal cetak");
    }
  };

  return (
    <DashboardLayout title="Pengaturan">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6 rounded-2xl border-slate-200">
          <h3 className="font-display text-xl font-bold mb-4">Info Toko</h3>
          <div className="space-y-4">
            <div><Label>Nama Toko</Label><Input data-testid="set-shop" value={form.shop_name} onChange={(e) => setForm({ ...form, shop_name: e.target.value })} className="min-h-[56px] rounded-xl border-2 mt-2" /></div>
            <div><Label>Alamat</Label><Input data-testid="set-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="min-h-[56px] rounded-xl border-2 mt-2" /></div>
            <div><Label>Nomor WA Pemilik (untuk laporan)</Label><Input data-testid="set-wa" placeholder="62812xxxx" value={form.owner_wa} onChange={(e) => setForm({ ...form, owner_wa: e.target.value })} className="min-h-[56px] rounded-xl border-2 mt-2" /></div>
            <div><Label>Ucapan Bawah Struk</Label><Textarea data-testid="set-footer" value={form.receipt_footer} onChange={(e) => setForm({ ...form, receipt_footer: e.target.value })} className="rounded-xl border-2 mt-2 min-h-[80px]" /></div>
            <Button onClick={save} data-testid="set-save" disabled={saving} className="min-h-[56px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold w-full">
              {saving ? "Menyimpan..." : "Simpan"}
            </Button>
          </div>
        </Card>

        <Card className="p-6 rounded-2xl border-slate-200">
          <h3 className="font-display text-xl font-bold mb-4">Gambar QRIS</h3>
          {store?.qris_image_path ? (
            <div className="mb-4">
              <img src={fileUrl(store.qris_image_path)} alt="QRIS" className="w-full max-w-xs rounded-xl border border-slate-200" data-testid="qris-preview" />
            </div>
          ) : (
            <div className="mb-4 h-40 rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-400">Belum ada QRIS</div>
          )}
          <label className="block">
            <input type="file" accept="image/*" className="hidden" onChange={uploadQris} data-testid="qris-upload" />
            <span className={`inline-flex items-center justify-center gap-2 min-h-[56px] rounded-xl px-6 bg-blue-600 hover:bg-blue-700 text-white font-bold w-full cursor-pointer transition-colors ${uploading ? "opacity-70" : ""}`}>
              <Upload className="w-5 h-5" /> {uploading ? "Mengunggah..." : "Unggah Gambar QRIS"}
            </span>
          </label>
        </Card>

        <Card className="p-6 rounded-2xl border-slate-200 lg:col-span-2">
          <h3 className="font-display text-xl font-bold mb-2 flex items-center gap-2"><Printer className="w-5 h-5" /> Printer Thermal Bluetooth</h3>
          <p className="text-slate-500 mb-4 text-sm">Pairing sekali di HP Android + Chrome. Kertas 58mm ESC/POS.</p>
          {!isBluetoothSupported() && (
            <div className="mb-4 p-4 rounded-xl bg-orange-50 border border-orange-200 text-orange-800 text-sm">
              Web Bluetooth tidak didukung di browser ini. Buka di <b>Chrome Android</b>.
            </div>
          )}
          {printerName && (
            <div className="mb-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-2 text-emerald-800" data-testid="printer-status">
              <CheckCircle2 className="w-5 h-5" /> Printer tersimpan: <b>{printerName}</b>
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <Button onClick={pairPrinter} data-testid="pair-printer" disabled={!isBluetoothSupported()} className="min-h-[56px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold">
              <Bluetooth className="w-5 h-5 mr-2" /> Pairing / Hubungkan Ulang
            </Button>
            <Button onClick={testPrint} variant="outline" data-testid="test-print" disabled={!isBluetoothSupported()} className="min-h-[56px] rounded-xl border-2 font-bold">
              Cetak Uji
            </Button>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
