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
import { Plus, Pencil, Trash2, Upload, ImageIcon } from "lucide-react";
import { toast } from "sonner";

const UNITS = ["pcs", "kg", "ons", "botol", "bungkus"];
const emptyForm = { name: "", price: 0, hpp: 0, stock: 0, unit: "pcs", low_stock_threshold: 5, category: "Umum", image_path: null, barcode: "" };

export default function Products() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [uploading, setUploading] = useState(false);
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
    </DashboardLayout>
  );
}
