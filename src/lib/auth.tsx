import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";
import { isDemoEmail } from "./demo";
import { applyDemoViewHeader, getDemoViewRole, setDemoViewRole } from "./demo-view";
import type { AppRole } from "./roles-core";

export type { AppRole } from "./roles-core";

// Stamp the demo's "View as" role before any page mounts and queries: React
// runs child effects first, so doing this in the provider would be too late
// for the first request. The database ignores the header for real accounts.
if (typeof window !== "undefined") applyDemoViewHeader(getDemoViewRole());

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  session: Session | null;
  roles: AppRole[];
  /** Roles the menu and role-gated pages follow: the demo's "View as" choice, otherwise the real roles. */
  viewRoles: AppRole[];
  isDemo: boolean;
  demoViewRole: AppRole;
  /** Demo only: switch the viewed role and reload so every query carries it. */
  switchDemoViewRole: (role: AppRole) => void;
  hasRole: (role: AppRole) => boolean;
  hasAnyRole: (roles: AppRole[]) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshRoles: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchRoles = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (data) {
      setRoles(data.map((r) => r.role as AppRole));
    }
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          await fetchRoles(session.user.id);
        } else {
          setRoles([]);
        }
        setIsLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchRoles(session.user.id);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [fetchRoles]);

  const login = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setRoles([]);
  };

  const refreshRoles = async () => {
    if (user) await fetchRoles(user.id);
  };

  const hasRole = (role: AppRole) => roles.includes(role);
  const hasAnyRole = (r: AppRole[]) => r.some((role) => roles.includes(role));

  const isDemo = isDemoEmail(user?.email);
  const demoViewRole = getDemoViewRole();
  const viewRoles = isDemo ? [demoViewRole] : roles;
  const switchDemoViewRole = (role: AppRole) => {
    setDemoViewRole(role);
    window.location.reload();
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: !!session,
        isLoading,
        user,
        session,
        roles,
        viewRoles,
        isDemo,
        demoViewRole,
        switchDemoViewRole,
        hasRole,
        hasAnyRole,
        login,
        logout,
        refreshRoles,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
