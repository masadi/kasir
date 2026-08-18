import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Store } from "lucide-react";
import { toast } from "sonner";

export default function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: "", shop_name: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await register(form);
      toast.success("Toko berhasil dibuat");
      nav("/onboarding");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Daftar gagal");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-sm p-8">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center">
            <Store className="w-5 h-5 text-white" />
          </div>
          <span className="font-display text-xl font-black">KasirKu</span>
        </div>
        <h2 className="font-display text-3xl font-black mb-2">Daftar Toko</h2>
        <p className="text-slate-500 mb-6">Buat akun pemilik untuk warungmu</p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label className="text-sm font-semibold">Nama Kamu</Label>
            <Input data-testid="reg-name" value={form.name} onChange={set("name")} required className="min-h-[56px] rounded-xl text-base border-2 mt-2" />
          </div>
          <div>
            <Label className="text-sm font-semibold">Nama Toko</Label>
            <Input data-testid="reg-shop" value={form.shop_name} onChange={set("shop_name")} required className="min-h-[56px] rounded-xl text-base border-2 mt-2" />
          </div>
          <div>
            <Label className="text-sm font-semibold">Email</Label>
            <Input data-testid="reg-email" type="email" value={form.email} onChange={set("email")} required className="min-h-[56px] rounded-xl text-base border-2 mt-2" />
          </div>
          <div>
            <Label className="text-sm font-semibold">Password</Label>
            <Input data-testid="reg-password" type="password" value={form.password} onChange={set("password")} required minLength={6} className="min-h-[56px] rounded-xl text-base border-2 mt-2" />
          </div>
          <Button data-testid="reg-submit" type="submit" disabled={loading}
            className="w-full min-h-[56px] rounded-xl text-lg font-bold bg-blue-600 hover:bg-blue-700 active:scale-95 transition-transform">
            {loading ? "Membuat..." : "Buat Toko"}
          </Button>
        </form>
        <p className="mt-6 text-sm text-slate-500 text-center">
          Sudah punya akun?{" "}
          <Link to="/login" className="text-blue-600 font-semibold hover:underline" data-testid="link-login">Masuk</Link>
        </p>
      </div>
    </div>
  );
}
