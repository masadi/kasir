import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Store } from "lucide-react";
import { toast } from "sonner";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const u = await login(email, password);
      toast.success(`Selamat datang, ${u.name}!`);
      nav(u.role === "owner" ? "/dashboard" : "/pos");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Login gagal");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <div className="hidden md:flex md:w-1/2 relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url(https://images.pexels.com/photos/33633752/pexels-photo-33633752.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940)" }}
        />
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-900/70 via-slate-900/50 to-blue-900/60" />
        <div className="relative z-10 flex flex-col justify-end p-12 text-white">
          <div className="inline-flex items-center gap-2 mb-6 px-4 py-2 rounded-full bg-white/10 backdrop-blur-md w-fit">
            <Store className="w-4 h-4" />
            <span className="text-xs tracking-[0.2em] uppercase font-semibold">KasirKu</span>
          </div>
          <h1 className="font-display text-5xl font-black tracking-tight mb-3">Kasir warungmu, di genggaman.</h1>
          <p className="text-lg text-white/80 max-w-md">POS + struk thermal + laporan otomatis. Cukup HP Android & printer bluetooth.</p>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center p-6 md:p-12 bg-white">
        <div className="w-full max-w-sm">
          <div className="md:hidden mb-8 flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center">
              <Store className="w-5 h-5 text-white" />
            </div>
            <span className="font-display text-xl font-black">KasirKu</span>
          </div>
          <h2 className="font-display text-3xl font-black mb-2">Masuk</h2>
          <p className="text-slate-500 mb-8">Selamat datang kembali</p>
          <form onSubmit={submit} className="space-y-5">
            <div>
              <Label htmlFor="email" className="text-sm font-semibold">Email</Label>
              <Input
                id="email" data-testid="login-email"
                type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                required autoComplete="email"
                className="min-h-[56px] rounded-xl text-base border-2 mt-2"
              />
            </div>
            <div>
              <Label htmlFor="password" className="text-sm font-semibold">Password</Label>
              <Input
                id="password" data-testid="login-password"
                type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                required autoComplete="current-password"
                className="min-h-[56px] rounded-xl text-base border-2 mt-2"
              />
            </div>
            <Button
              type="submit" data-testid="login-submit" disabled={loading}
              className="w-full min-h-[56px] rounded-xl text-lg font-bold bg-blue-600 hover:bg-blue-700 active:scale-95 transition-transform"
            >
              {loading ? "Masuk..." : "Masuk"}
            </Button>
          </form>
          <p className="mt-6 text-sm text-slate-500 text-center">
            Belum punya akun?{" "}
            <Link to="/register" className="text-blue-600 font-semibold hover:underline" data-testid="link-register">
              Daftar toko
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
