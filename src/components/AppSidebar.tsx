import {
  LayoutDashboard,
  Users,
  MapPin,
  Clipboard,
  AlertTriangle,
  Map,
  MessageCircleQuestion,
  FileText,
  UserCog,
  Settings,
  Handshake,
  Truck,
  Boxes,
  ShieldCheck,
  SearchCheck,
  Trophy,
  Droplets,
  Warehouse,
  PackageCheck,
  DollarSign,
  FlaskConical,
  PlayCircle,
  Compass,
} from "lucide-react";
import { Link, useLocation } from "@tanstack/react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth";
import { isDemoEmail } from "@/lib/demo";
import { useI18n, type I18nKey } from "@/lib/i18n";

type NavItem = { key: I18nKey; url: string; icon: typeof LayoutDashboard };

const fieldItems: NavItem[] = [
  { key: "nav.dashboard", url: "/dashboard", icon: LayoutDashboard },
  { key: "nav.farmers", url: "/farmers", icon: Users },
  { key: "nav.farms", url: "/farms", icon: MapPin },
  { key: "nav.visits", url: "/visits", icon: Clipboard },
  { key: "nav.alerts", url: "/alerts", icon: AlertTriangle },
  { key: "nav.map", url: "/map", icon: Map },
  { key: "nav.water", url: "/water", icon: Droplets },
];

const officeItems: NavItem[] = [
  { key: "nav.reports", url: "/reports", icon: FileText },
  { key: "nav.ask", url: "/ask", icon: MessageCircleQuestion },
];

const presentItems: NavItem[] = [
  { key: "nav.demo", url: "/demo", icon: PlayCircle },
  { key: "nav.tour", url: "/tour", icon: Compass },
];

const tradeItems: NavItem[] = [
  { key: "nav.contracts", url: "/contracts", icon: Handshake },
  { key: "nav.deliveries", url: "/deliveries", icon: Truck },
  { key: "nav.batches", url: "/batches", icon: Boxes },
  { key: "nav.stock", url: "/stock", icon: Warehouse },
  { key: "nav.dispatches", url: "/dispatches", icon: PackageCheck },
  { key: "nav.quality", url: "/qc", icon: FlaskConical },
  { key: "nav.ranking", url: "/ranking", icon: Trophy },
  { key: "nav.prices", url: "/prices", icon: DollarSign },
  { key: "nav.recall", url: "/recall", icon: SearchCheck },
  { key: "nav.compliance", url: "/compliance", icon: ShieldCheck },
];

const adminItems: NavItem[] = [
  { key: "nav.users", url: "/users", icon: UserCog },
  { key: "nav.settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const currentPath = location.pathname;
  const { user, hasRole, hasAnyRole } = useAuth();
  const { t } = useI18n();

  // A field officer's day is farms, visits and alerts. Showing them contracts,
  // prices and QC just buries the four things they actually use — the menu is
  // trimmed per role, not per permission (RLS still enforces the real rules).
  // The roleless demo account gets the full office view — it is there to be
  // looked at, and the database keeps it read-only regardless.
  const officeOnly = hasAnyRole(["admin", "manager"]) || isDemoEmail(user?.email);
  const isAdmin = hasRole("admin");

  const isActive = (path: string) =>
    currentPath === path || currentPath.startsWith(path + "/");

  // One group per working context. Field officers see the field; the office
  // sees trade and reports; admins get the two admin pages folded into Office.
  const groups: { label: I18nKey; items: NavItem[] }[] = [
    { label: "nav.field", items: fieldItems },
    ...(officeOnly ? [{ label: "nav.trade" as I18nKey, items: tradeItems }] : []),
    {
      label: "nav.office",
      items: [...(officeOnly ? officeItems : officeItems.filter((i) => i.url !== "/reports")), ...(isAdmin ? adminItems : [])],
    },
    { label: "nav.present", items: presentItems },
  ];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-3 py-3">
        <Link to="/dashboard" className="flex items-center gap-2.5">
          <img src="/brm-agro-logo.png" alt="BRM Agro" className="h-6 w-auto object-contain" />
          {!collapsed && (
            <span className="flex flex-col leading-none">
              <span className="text-[14px] font-medium text-sidebar-foreground">Field Watch</span>
              <span className="num mt-0.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">BRM Agro</span>
            </span>
          )}
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((g) => (
          <SidebarGroup key={g.label} className="py-1.5">
            <SidebarGroupLabel className="num h-6 px-3 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80">
              {t(g.label)}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0">
                {g.items.map((item) => (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive(item.url)}
                      className="h-8 rounded-none px-3 text-[13px] text-sidebar-foreground/85 hover:bg-sidebar-accent/60 data-[active=true]:bg-transparent data-[active=true]:font-medium data-[active=true]:text-primary data-[active=true]:shadow-[inset_2px_0_0_0_var(--primary)]"
                    >
                      <Link to={item.url}>
                        <item.icon className="h-4 w-4 opacity-80" />
                        <span>{t(item.key)}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
