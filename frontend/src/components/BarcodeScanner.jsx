import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, X, Zap } from "lucide-react";

// Uses the native BarcodeDetector API (Chrome Android has it — same target as Web Bluetooth).
// Falls back to manual input if the API is missing.
export function isScannerSupported() {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

export default function BarcodeScanner({ open, onOpenChange, onDetected }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const runningRef = useRef(false);
  const [error, setError] = useState(null);
  const [manual, setManual] = useState("");

  useEffect(() => {
    if (!open) {
      stop();
      setError(null);
      setManual("");
      return;
    }
    start();
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const stop = () => {
    runningRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const start = async () => {
    if (!isScannerSupported()) {
      setError("Kamera-scan tidak didukung. Buka di Chrome Android atau isi manual.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const detector = new window.BarcodeDetector({
        formats: ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "qr_code", "itf"],
      });
      runningRef.current = true;
      const loop = async () => {
        if (!runningRef.current || !videoRef.current) return;
        try {
          const results = await detector.detect(videoRef.current);
          if (results && results.length) {
            const code = results[0].rawValue;
            if (code) {
              stop();
              onDetected(code);
              return;
            }
          }
        } catch (_) { /* transient decode error */ }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    } catch (err) {
      setError(err.message || "Tidak bisa akses kamera. Izinkan lewat pengaturan browser.");
    }
  };

  const submitManual = (e) => {
    e.preventDefault();
    if (manual.trim()) onDetected(manual.trim());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-black flex items-center gap-2">
            <Camera className="w-5 h-5" /> Scan Barcode
          </DialogTitle>
        </DialogHeader>

        <div className="relative aspect-video rounded-xl overflow-hidden bg-slate-900" data-testid="scanner-view">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-4/5 h-24 border-4 border-emerald-400 rounded-lg shadow-lg" />
          </div>
          {isScannerSupported() && !error && (
            <div className="absolute bottom-2 left-2 right-2 text-center text-xs text-white/80 flex items-center justify-center gap-1">
              <Zap className="w-3 h-3" /> Arahkan barcode ke kotak hijau
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center p-4 bg-slate-900/85">
              <p className="text-white text-sm text-center">{error}</p>
            </div>
          )}
        </div>

        <form onSubmit={submitManual} className="pt-2">
          <div className="text-xs tracking-[0.2em] uppercase font-semibold text-slate-500 mb-2">
            Atau ketik manual
          </div>
          <div className="flex gap-2">
            <input
              type="text" inputMode="numeric" autoComplete="off"
              value={manual} onChange={(e) => setManual(e.target.value)}
              placeholder="8991234567890"
              data-testid="scanner-manual-input"
              className="flex-1 min-h-[52px] rounded-xl border-2 border-slate-200 px-4 text-lg font-mono focus:border-blue-600 focus:ring-4 focus:ring-blue-100 outline-none"
            />
            <Button type="submit" data-testid="scanner-manual-submit" className="min-h-[52px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold px-6">
              OK
            </Button>
          </div>
        </form>

        <Button
          variant="outline" onClick={() => onOpenChange(false)}
          data-testid="scanner-close"
          className="min-h-[52px] rounded-xl mt-2"
        >
          <X className="w-4 h-4 mr-2" /> Tutup
        </Button>
      </DialogContent>
    </Dialog>
  );
}
