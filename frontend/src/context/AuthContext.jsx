import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = checking, false = anon, obj = logged
  const [store, setStore] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/auth/me");
        setUser(data);
        const s = await api.get("/store");
        setStore(s.data);
      } catch (e) {
        console.error("Auth check failed:", e);
        setUser(false);
      }
    })();
  }, []);

  const refreshStore = async () => {
    try {
      const s = await api.get("/store");
      setStore(s.data);
      return s.data;
    } catch (e) {
      console.error("Refresh store failed:", e);
    }
  };

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    if (data.token) localStorage.setItem("kasirku_token", data.token);
    setUser(data);
    const s = await api.get("/store");
    setStore(s.data);
    return data;
  };

  const register = async (payload) => {
    const { data } = await api.post("/auth/register", payload);
    if (data.token) localStorage.setItem("kasirku_token", data.token);
    setUser(data);
    const s = await api.get("/store");
    setStore(s.data);
    return data;
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch (e) { console.error("Logout failed:", e); }
    localStorage.removeItem("kasirku_token");
    setUser(false);
    setStore(null);
  };

  return (
    <AuthContext.Provider value={{ user, store, setStore, login, register, logout, refreshStore }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
