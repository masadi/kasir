import { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { UserPlus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function Cashiers() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "" });

  const load = async () => setItems((await api.get("/cashiers")).data);
  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      await api.post("/cashiers", form);
      toast.success("Kasir ditambahkan");
      setOpen(false);
      setForm({ name: "", email: "", password: "" });
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const del = async (c) => {
    if (!window.confirm(`Hapus kasir ${c.name}?`)) return;
    await api.delete(`/cashiers/${c.id}`);
    load();
  };

  return (
    <DashboardLayout title="Kasir">
      <div className="flex items-center justify-between mb-6">
        <p className="text-slate-500">{items.length} akun kasir</p>
        <Button onClick={() => setOpen(true)} data-testid="btn-add-cashier" className="min-h-[56px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold">
          <UserPlus className="w-5 h-5 mr-2" /> Tambah Kasir
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((c) => (
          <Card key={c.id} className="p-6 rounded-2xl border-slate-200" data-testid={`cashier-${c.id}`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="font-display text-lg font-bold">{c.name}</div>
                <div className="text-sm text-slate-500">{c.email}</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => del(c)} data-testid={`del-cashier-${c.id}`}>
                <Trash2 className="w-4 h-4 text-red-600" />
              </Button>
            </div>
          </Card>
        ))}
        {items.length === 0 && <p className="text-slate-500">Belum ada kasir</p>}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle className="font-display text-2xl font-black">Kasir Baru</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Nama</Label><Input data-testid="cashier-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="min-h-[56px] rounded-xl border-2 mt-2" /></div>
            <div><Label>Email</Label><Input data-testid="cashier-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="min-h-[56px] rounded-xl border-2 mt-2" /></div>
            <div><Label>Password</Label><Input data-testid="cashier-pw" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={6} className="min-h-[56px] rounded-xl border-2 mt-2" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="min-h-[52px] rounded-xl">Batal</Button>
            <Button onClick={save} data-testid="cashier-save" className="min-h-[52px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold">Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
