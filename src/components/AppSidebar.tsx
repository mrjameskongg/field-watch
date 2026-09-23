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
  ScrollText,
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
import { navAllowed } from "@/lib/roles-core";
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
  { key: "nav.audit", url: "/audit", icon: ScrollText },
  { key: "nav.users", url: "/users", icon: UserCog },
  { key: "nav.settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const currentPath = location.pathname;
  const { viewRoles, isDemo } = useAuth();
  const { t } = useI18n();

  // Each role sees its working pages (NAV_ACCESS in roles-core.ts). This is
  // about focus, not security: the database enforces the same matrix. The
  // demo follows its "View as" role; Users and Settings stay hidden for it
  // because the demo can read neither.
  const allowed = (i: NavItem) =>
    navAllowed(viewRoles, i.url) && !(isDemo && (i.url === "/users" || i.url === "/settings"));

  const isActive = (path: string) =>
    currentPath === path || currentPath.startsWith(path + "/");

  // One group per working context. Field officers see the field; the office
  // sees trade and reports; admins get the two admin pages folded into Office.
  const groups: { label: I18nKey; items: NavItem[] }[] = [
    { label: "nav.field" as I18nKey, items: fieldItems.filter(allowed) },
    { label: "nav.trade" as I18nKey, items: tradeItems.filter(allowed) },
    { label: "nav.office" as I18nKey, items: [...officeItems, ...adminItems].filter(allowed) },
    { label: "nav.present" as I18nKey, items: presentItems },
  ].filter((g) => g.items.length > 0);

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
