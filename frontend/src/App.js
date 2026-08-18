import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import OfflineIndicator from "@/components/OfflineIndicator";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Onboarding from "@/pages/Onboarding";
import Dashboard from "@/pages/Dashboard";
import Products from "@/pages/Products";
import Cashiers from "@/pages/Cashiers";
import Settings from "@/pages/Settings";
import History from "@/pages/History";
import POS from "@/pages/POS";

function RoleHome() {
  const { user } = useAuth();
  if (user === null) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "owner") return <Navigate to="/dashboard" replace />;
  return <Navigate to="/pos" replace />;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-center" richColors />
        <OfflineIndicator />
        <Routes>
          <Route path="/" element={<RoleHome />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/onboarding" element={
            <ProtectedRoute ownerOnly><Onboarding /></ProtectedRoute>
          } />
          <Route path="/dashboard" element={
            <ProtectedRoute ownerOnly><Dashboard /></ProtectedRoute>
          } />
          <Route path="/products" element={
            <ProtectedRoute ownerOnly><Products /></ProtectedRoute>
          } />
          <Route path="/cashiers" element={
            <ProtectedRoute ownerOnly><Cashiers /></ProtectedRoute>
          } />
          <Route path="/settings" element={
            <ProtectedRoute ownerOnly><Settings /></ProtectedRoute>
          } />
          <Route path="/history" element={
            <ProtectedRoute><History /></ProtectedRoute>
          } />
          <Route path="/pos" element={
            <ProtectedRoute><POS /></ProtectedRoute>
          } />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
