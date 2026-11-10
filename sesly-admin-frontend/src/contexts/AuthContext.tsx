"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AuthService } from "@/services/admin.service";
import { AdminRole } from "@/types/api.types";
import { ADMIN_TOKEN_REFRESHED_EVENT } from "@/lib/api";

interface Admin {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: AdminRole;
}

interface AuthContextType {
  admin: Admin | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = "admin_token";
const REFRESH_TOKEN_KEY = "admin_refresh_token";
const ADMIN_DATA_KEY = "admin_data";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    const adminData = localStorage.getItem(ADMIN_DATA_KEY);

    if (token && adminData) {
      try {
        setAdmin(JSON.parse(adminData));
      } catch (error) {
        console.error("Failed to parse admin data:", error);
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
        localStorage.removeItem(ADMIN_DATA_KEY);
      }
    }
    setIsLoading(false);
  }, []);

  // The axios interceptor can silently refresh the admin token in the
  // background. When that happens, re-read admin data from localStorage so
  // React state doesn't drift out of sync with what we're actually sending.
  useEffect(() => {
    const handleRefresh = () => {
      const adminData = localStorage.getItem(ADMIN_DATA_KEY);
      if (adminData) {
        try {
          setAdmin(JSON.parse(adminData));
        } catch {
          // Malformed — ignore; interceptor will bounce on next failure.
        }
      }
    };
    window.addEventListener(ADMIN_TOKEN_REFRESHED_EVENT, handleRefresh);
    return () =>
      window.removeEventListener(ADMIN_TOKEN_REFRESHED_EVENT, handleRefresh);
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const response = await AuthService.login({ email, password });
      const { accessToken, refreshToken, admin: adminData } = response.data;

      localStorage.setItem(TOKEN_KEY, accessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
      localStorage.setItem(ADMIN_DATA_KEY, JSON.stringify(adminData));

      setAdmin(adminData);
      router.push("/dashboard");
    } catch (error: unknown) {
      console.error("Login failed:", error);
      const message = (error as { response?: { data?: { message?: string } } })
        ?.response?.data?.message;
      throw new Error(message || "Login failed");
    }
  };

  const logout = async () => {
    try {
      await AuthService.logout();
    } catch (error) {
      console.error("Logout API call failed:", error);
    } finally {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      localStorage.removeItem(ADMIN_DATA_KEY);
      setAdmin(null);
      router.push("/login");
    }
  };

  const value: AuthContextType = {
    admin,
    isLoading,
    isAuthenticated: !!admin,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
