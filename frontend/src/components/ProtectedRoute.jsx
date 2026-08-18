import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

export function ProtectedRoute({ children, ownerOnly }) {
  const { user, store } = useAuth();
  if (user === null) {
    return (
      <div className="flex items-center justify-center min-h-screen text-slate-500">
        Memuat...
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (ownerOnly && user.role !== "owner") return <Navigate to="/pos" replace />;
  if (user.role === "owner" && store && !store.onboarded && window.location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }
  return children;
}
