import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authApi, setAccessToken } from '../api';
import { getAccessToken } from '../api/axios';

interface User {
  id: number;
  email: string;
  role: 'admin' | 'staff' | 'customer';
  customer?: { id: number; first_name: string; last_name: string } | null;
  staff?: { id: number; first_name: string; last_name: string; position: string } | null;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (data: any) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = async () => {
    try {
      const { data } = await authApi.getProfile();
      setUser(data.data);
    } catch {
      setUser(null);
      setAccessToken(null);
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      // Guests should not wait for a guaranteed 401 before the public page and
      // chat button can render. Signed-in visitors still validate their session.
      if (!getAccessToken()) {
        setLoading(false);
        return;
      }
      try {
        const { data } = await authApi.getProfile();
        setUser(data.data);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    initAuth();
  }, []);

  const login = async (email: string, password: string) => {
    const { data } = await authApi.login({ email, password });
    setAccessToken(data.data.accessToken);
    setUser(data.data.user);
    return data.data.user;
  };

  const register = async (registerData: any) => {
    const { data } = await authApi.register(registerData);
    setAccessToken(data.data.accessToken);
    setUser(data.data.user);
    return data.data.user;
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
      setAccessToken(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
