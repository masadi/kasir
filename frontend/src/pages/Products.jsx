import { useEffect, useRef, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { api, fileUrl, formatApiError } from "@/lib/api";
import { rupiah } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, Upload, ImageIcon, Tag, Printer } from "lucide-react";
import { toast } from "sonner";
import { printLabels, generateBarcode, isBluetoothSupported } from "@/lib/thermal-printer";

const UNITS = ["pcs", "kg", "ons", "botol", "bungkus"];
const emptyForm = { name: "", price: 0, hpp: 0, stock: 0, unit: "pcs", low_stock_threshold: 5, category: "Umum", image_path: null, barcode: "" };

export default function Products() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [labelFor, setLabelFor] = useState(null);
  const [labelQty, setLabelQty] = useState(1);
  const fileRef = useRef(null);

  const load = async () => setItems((await api.get("/products")).data);
  useEffect(() => { load(); }, []);

  const openAdd = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (p) => { setEditing(p); setForm({ ...emptyForm, ...p }); setOpen(true); };

  const save = async () => {
    try {
      const payload = { ...form, price: Number(form.price), hpp: Number(form.hpp), stock: Number(form.stock), low_stock_threshold: Number(form.low_stock_threshold) };
      if (editing) await api.put(`/products/${editing.id}`, payload);
      else await api.post("/products", payload);
      toast.success(editing ? "Produk diperbarui" : "Produk ditambahkan");
      setOpen(false);
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gagal simpan");
    }
  };

  const del = async (p) => {
    if (!window.confirm(`Hapus ${p.name}?`)) return;
    await api.delete(`/products/${p.id}`);
    toast.success("Produk dihapus");
    load();
  };

  const uploadPhoto = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) { toast.error("File harus gambar"); return; }
    if (f.size > 5 * 1024 * 1024) { toast.error("Ukuran gambar maks 5MB"); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await api.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setForm((prev) => ({ ...prev, image_path: r.data.path }));
      toast.success("Foto terunggah");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Upload gagal");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removePhoto = () => setForm((prev) => ({ ...prev, image_path: null }));

  const openLabel = (p) => { setLabelFor(p); setLabelQty(1); };
  const closeLabel = () => { setLabelFor(null); setLabelQty(1); };

  const previewCode = labelFor ? ((labelFor.barcode && labelFor.barcode.trim()) || generateBarcode(labelFor.id)) : "";

  const printLabelNow = async () => {
    if (!labelFor) return;
    // Auto-persist generated barcode so scans match printed labels
    let target = labelFor;
    if (!labelFor.barcode || !labelFor.barcode.trim()) {
      const code = generateBarcode(labelFor.id);
      try {
        const payload = { ...labelFor, barcode: code };
        delete payload.id; delete payload.owner_id;
        const r = await api.put(`/products/${labelFor.id}`, payload);
        target = r.data;
        setItems((prev) => prev.map((x) => (x.id === target.id ? target : x)));
        toast.success(`Barcode dibuat: ${code}`);
      } catch (e) {
        toast.error(formatApiError(e.response?.data?.detail) || "Gagal simpan barcode");
        return;
      }
    }
    try {
      await printLabels({ product: target, qty: labelQty, price: target.price });
      toast.success(`${labelQty} label tercetak`);
      closeLabel();
    } catch (err) {
      toast.error(err.message || "Gagal cetak");
    }
  };

  return (
    <DashboardLayout title="Produk">
      <div className="flex items-center justify-between mb-6">
        <p className="text-slate-500">{items.length} produk aktif</p>
        <Button onClick={openAdd} data-testid="btn-add-product" className="min-h-[56px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-base active:scale-95 transition-transform">
          <Plus className="w-5 h-5 mr-2" /> Tambah Produk
        </Button>
      </div>

      <Card className="rounded-2xl border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 text-xs tracking-[0.15em] uppercase text-slate-500">
              <tr>
                <th className="text-left p-4 w-16">Foto</th>
                <th className="text-left p-4">Nama</th>
                <th className="text-left p-4">Kategori</th>
                <th className="text-right p-4">Harga</th>
                <th className="text-right p-4">HPP</th>
                <th className="text-right p-4">Stok</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody data-testid="products-table">
              {items.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="p-4">
                    <div className="w-12 h-12 rounded-xl bg-slate-100 overflow-hidden flex items-center justify-center">
                      {p.image_path ? (
                        <img src={fileUrl(p.image_path)} alt={p.name} className="w-full h-full object-cover" />
                      ) : (
                        <ImageIcon className="w-5 h-5 text-slate-300" />
                      )}
                    </div>
                  </td>
                  <td className="p-4 font-semibold">{p.name}</td>
                  <td className="p-4 text-slate-500">{p.category}</td>
                  <td className="p-4 text-right">{rupiah(p.price)}</td>
                  <td className="p-4 text-right text-slate-500">{rupiah(p.hpp)}</td>
                  <td className={`p-4 text-right font-semibold ${p.stock <= p.low_stock_threshold ? "text-orange-600" : ""}`}>
                    {p.stock} {p.unit}
                  </td>
                  <td className="p-4 text-right whitespace-nowrap">
                    <Button variant="ghost" size="sm" onClick={() => openLabel(p)} data-testid={`label-${p.id}`} title="Cetak label barcode">
                      <Tag className="w-4 h-4 text-blue-600" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(p)} data-testid={`edit-${p.id}`}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => del(p)} data-testid={`del-${p.id}`}>
                      <Trash2 className="w-4 h-4 text-red-600" />
                    </Button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan="7" className="p-8 text-center text-slate-500">Belum ada produk</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg rounded-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-black">{editing ? "Edit Produk" : "Produk Baru"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Foto Produk</Label>
              <div className="mt-2 flex items-center gap-4">
                <div className="w-24 h-24 rounded-2xl bg-slate-100 border-2 border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                  {form.image_path ? (
                    <img src={fileUrl(form.image_path)} alt="Preview" className="w-full h-full object-cover" data-testid="prod-image-preview" />
                  ) : (
                    <ImageIcon className="w-8 h-8 text-slate-300" />
                  )}
                </div>
                <div className="flex-1 flex flex-col gap-2">
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={uploadPhoto} data-testid="prod-image-input" />
                  <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="prod-image-btn" className="min-h-[44px] rounded-xl border-2 font-semibold">
                    <Upload className="w-4 h-4 mr-2" /> {uploading ? "Mengunggah..." : (form.image_path ? "Ganti Foto" : "Unggah Foto")}
                  </Button>
                  {form.image_path && (
                    <Button type="button" variant="ghost" onClick={removePhoto} data-testid="prod-image-remove" className="text-red-600 h-8 text-xs">
                      Hapus foto
                    </Button>
                  )}
                </div>
              </div>
            </div>
            <div>
              <Label>Nama</Label>
              <Input data-testid="prod-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="min-h-[56px] rounded-xl border-2 mt-2" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Harga Jual</Label>
                <Input data-testid="prod-price" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="min-h-[56px] rounded-xl border-2 mt-2" />
              </div>
              <div>
                <Label>HPP (modal)</Label>
                <Input data-testid="prod-hpp" type="number" value={form.hpp} onChange={(e) => setForm({ ...form, hpp: e.target.value })} className="min-h-[56px] rounded-xl border-2 mt-2" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Stok</Label>
                <Input data-testid="prod-stock" type="number" step="0.1" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} className="min-h-[56px] rounded-xl border-2 mt-2" />
              </div>
              <div>
                <Label>Satuan</Label>
                <Select value={form.unit} onValueChange={(v) => setForm({ ...form, unit: v })}>
                  <SelectTrigger data-testid="prod-unit" className="min-h-[56px] rounded-xl border-2 mt-2"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Barcode (opsional)</Label>
              <Input data-testid="prod-barcode" value={form.barcode || ""} onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                placeholder="8991234567890"
                className="min-h-[56px] rounded-xl border-2 mt-2 font-mono" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Kategori</Label>
                <Input data-testid="prod-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="min-h-[56px] rounded-xl border-2 mt-2" />
              </div>
              <div>
                <Label>Ambang Stok Menipis</Label>
                <Input data-testid="prod-low" type="number" value={form.low_stock_threshold} onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })} className="min-h-[56px] rounded-xl border-2 mt-2" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="min-h-[52px] rounded-xl">Batal</Button>
            <Button onClick={save} data-testid="prod-save" className="min-h-[52px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold">Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!labelFor} onOpenChange={(v) => !v && closeLabel()}>
        <DialogContent className="rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-black flex items-center gap-2">
              <Tag className="w-5 h-5 text-blue-600" /> Cetak Label Barcode
            </DialogTitle>
          </DialogHeader>
          {labelFor && (
            <div className="space-y-4">
              <div className="p-5 rounded-2xl border-2 border-slate-200 bg-slate-50 text-center">
                <div className="font-semibold text-lg">{labelFor.name}</div>
                <div className="text-emerald-700 font-bold text-xl mt-1">{rupiah(labelFor.price)}</div>
                <div className="mt-3 font-mono text-sm tracking-widest text-slate-700" data-testid="label-preview-code">
                  {previewCode}
                </div>
                {!labelFor.barcode && (
                  <div className="mt-2 text-xs text-blue-700">
                    Otomatis dibuat & disimpan saat cetak
                  </div>
                )}
              </div>
              <div>
                <Label>Jumlah Label</Label>
                <Input
                  data-testid="label-qty"
                  type="number" min="1" max="50" value={labelQty}
                  onChange={(e) => setLabelQty(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                  className="min-h-[56px] rounded-xl border-2 mt-2 text-center text-xl font-bold"
                />
              </div>
              {!isBluetoothSupported() && (
                <div className="p-3 rounded-xl bg-orange-50 border border-orange-200 text-orange-800 text-sm">
                  Web Bluetooth tidak didukung — buka di Chrome Android untuk cetak.
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeLabel} className="min-h-[52px] rounded-xl">Batal</Button>
            <Button
              onClick={printLabelNow}
              disabled={!isBluetoothSupported()}
              data-testid="label-print"
              className="min-h-[52px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold"
            >
              <Printer className="w-4 h-4 mr-2" /> Cetak {labelQty} Label
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
