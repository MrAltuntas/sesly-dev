import {
    LayoutDashboard,
    Users,
    Mic2,
    Waves,
    BookOpen,
    CreditCard,
    Settings,
    ShieldAlert,
    HardDrive,
    Library,
    FileText,
    Mail,
    type LucideIcon,
} from "lucide-react";
import type { PermissionKey, Permissions } from "@/hooks/usePermissions";

export interface NavItem {
    href: string;
    label: string;
    icon: LucideIcon;
    /** Permission required to see the item and open the route. */
    permission: PermissionKey;
}

// Order matters: the first item a role can access is where that role lands
// when it opens a page it cannot use (e.g. MODERATOR on /dashboard).
export const NAV_ITEMS: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "canViewAnalytics" },
    { href: "/users", label: "Users", icon: Users, permission: "canViewUsers" },
    { href: "/stories", label: "Stories", icon: BookOpen, permission: "canViewStories" },
    { href: "/collections", label: "Koleksiyonlar", icon: Library, permission: "canViewCollections" },
    { href: "/audio", label: "Audio", icon: Mic2, permission: "canViewAudio" },
    { href: "/voice-test", label: "Ses Klon Testi", icon: Waves, permission: "canRunVoiceTest" },
    { href: "/moderation", label: "Moderation", icon: ShieldAlert, permission: "canViewModeration" },
    { href: "/finance", label: "Finance", icon: CreditCard, permission: "canViewFinance" },
    { href: "/storage", label: "Storage", icon: HardDrive, permission: "canViewStorage" },
    { href: "/legal", label: "Yasal", icon: FileText, permission: "canViewLegal" },
    { href: "/email-templates", label: "E-posta şablonları", icon: Mail, permission: "canViewEmailTemplates" },
    { href: "/settings", label: "Settings", icon: Settings, permission: "canViewSettings" },
];

export function visibleNavItems(perms: Permissions): NavItem[] {
    return NAV_ITEMS.filter((item) => perms[item.permission]);
}

/** Nav item owning `pathname` (exact match or nested route), if any. */
export function navItemForPath(pathname: string): NavItem | undefined {
    return NAV_ITEMS.find(
        (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
    );
}
