import { useEffect, useState } from "react";
import { Wifi, WifiOff, CloudUpload, CheckCircle2 } from "lucide-react";
import { isOnline, getPendingCount, syncPending } from "@/lib/offline";
import { useAuth } from "@/context/AuthContext";

export default function OfflineIndicator() {
  const { user } = useAuth();
  const [online, setOnline] = useState(isOnline());
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const ownerId = user?.owner_id;

  const refreshPending = async () => {
    if (!ownerId) return;
    setPending(await getPendingCount(ownerId));
  };

  useEffect(() => {
    refreshPending();
    const onOnline = async () => {
      setOnline(true);
      if (ownerId) {
        setSyncing(true);
        await syncPending(ownerId);
        setSyncing(false);
        refreshPending();
      }
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const t = setInterval(refreshPending, 5000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);

  const doSync = async () => {
    if (!ownerId) return;
    setSyncing(true);
    await syncPending(ownerId);
    setSyncing(false);
    refreshPending();
  };

  if (online && pending === 0 && !syncing) return null;

  return (
    <div
      data-testid="offline-indicator"
      className={`fixed top-2 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full shadow-lg backdrop-blur-md text-sm font-semibold flex items-center gap-2 ${
        !online
          ? "bg-orange-100/95 text-orange-800 border border-orange-300"
          : syncing
          ? "bg-blue-100/95 text-blue-800 border border-blue-300"
          : "bg-emerald-100/95 text-emerald-800 border border-emerald-300"
      }`}
    >
      {!online ? (
        <>
          <WifiOff className="w-4 h-4" /> Offline · {pending} antrean
        </>
      ) : syncing ? (
        <>
          <CloudUpload className="w-4 h-4 animate-pulse" /> Menyinkronkan...
        </>
      ) : (
        <>
          <button onClick={doSync} data-testid="sync-btn" className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> Online · {pending} belum tersinkron · Sync
          </button>
        </>
      )}
    </div>
  );
}
