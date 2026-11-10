"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { navItemForPath, visibleNavItems } from "@/components/layout/nav-items";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { isAuthenticated, isLoading } = useAuth();
    const permissions = usePermissions();
    const router = useRouter();
    const pathname = usePathname();

    // Route-level role gate: if the current page belongs to a nav item this
    // role cannot use (e.g. MODERATOR on /dashboard, which needs analytics),
    // send them to the first page they can use instead of a wall of 403s.
    const currentItem = navItemForPath(pathname);
    const isForbiddenRoute = !!currentItem && !permissions[currentItem.permission];
    const fallbackHref = visibleNavItems(permissions)[0]?.href;

    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            router.push("/login");
        }
    }, [isAuthenticated, isLoading, router]);

    useEffect(() => {
        if (!isLoading && isAuthenticated && isForbiddenRoute && fallbackHref) {
            router.replace(fallbackHref);
        }
    }, [isLoading, isAuthenticated, isForbiddenRoute, fallbackHref, router]);

    if (isLoading || (isAuthenticated && isForbiddenRoute && fallbackHref)) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background">
                <div className="text-center">
                    <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-muted-foreground">Loading...</p>
                </div>
            </div>
        );
    }

    if (!isAuthenticated) {
        return null;
    }

    return (
        <ErrorBoundary>
            <ConfirmProvider>
                <div className="flex min-h-screen bg-background text-foreground">
                    <Sidebar />
                    <main className="flex-1 p-8 overflow-y-auto max-h-screen">
                        {children}
                    </main>
                </div>
            </ConfirmProvider>
        </ErrorBoundary>
    );
}
