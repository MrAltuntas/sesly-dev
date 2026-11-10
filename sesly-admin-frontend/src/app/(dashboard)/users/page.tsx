"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, Ban, Loader2, Trash2, Users as UsersIcon, UserCheck, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { UsersService } from "@/services/admin.service";
import { User, UserStats } from "@/types/api.types";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ErrorState, getErrorMessage } from "@/components/ui/error-state";
import { Pagination } from "@/components/ui/pagination";
import { END_SUBSCRIPTION_CONFIRM_MESSAGE, DELETE_USER_CONFIRM_MESSAGE } from "@/lib/user-actions";
import { useRouter } from "next/navigation";

const PAGE_SIZE = 25;

// Backend returns subscriptionsByPlan as [{ plan, count }], not a keyed object.
const planCount = (stats: UserStats | null, plan: string) =>
    stats?.subscriptionsByPlan?.find((p) => p.plan === plan)?.count ?? 0;

export default function UsersPage() {
    const [users, setUsers] = useState<User[]>([]);
    const [userStats, setUserStats] = useState<UserStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [loadingStats, setLoadingStats] = useState(true);
    const [statsError, setStatsError] = useState<string | null>(null);
    const [searchInput, setSearchInput] = useState("");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(1);
    const { canDeactivateUser, canDeleteUser } = usePermissions();
    const toast = useToast();
    const confirm = useConfirm();
    const router = useRouter();

    const loadUserStats = useCallback(async () => {
        setLoadingStats(true);
        setStatsError(null);
        try {
            const res = await UsersService.getStats();
            setUserStats(res.data);
        } catch (e) {
            console.error("Failed to load user stats", e);
            setStatsError(getErrorMessage(e, "Could not load user statistics."));
        } finally {
            setLoadingStats(false);
        }
    }, []);

    const loadUsers = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await UsersService.getAll({
                page,
                limit: PAGE_SIZE,
                search: search || undefined,
            });
            setUsers(res.data.data);
            setTotal(res.data.total);
            setTotalPages(res.data.totalPages);
        } catch (e) {
            console.error("Failed to load users", e);
            setUsers([]);
            setError(getErrorMessage(e, "Could not load users."));
        } finally {
            setLoading(false);
        }
    }, [page, search]);

    useEffect(() => {
        loadUserStats();
    }, [loadUserStats]);

    useEffect(() => {
        loadUsers();
    }, [loadUsers]);

    // Debounce the search box; a new query always starts at page 1.
    useEffect(() => {
        const timer = setTimeout(() => {
            const next = searchInput.trim();
            if (next !== search) {
                setSearch(next);
                setPage(1);
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [searchInput, search]);

    const handleEndSubscription = async (user: User) => {
        if (!canDeactivateUser) {
            toast.error("You don't have permission to end subscriptions");
            return;
        }
        const ok = await confirm({
            title: `End subscription for ${user.email}?`,
            message: END_SUBSCRIPTION_CONFIRM_MESSAGE,
            confirmLabel: "End subscription",
            variant: "destructive",
        });
        if (!ok) return;
        try {
            await UsersService.deactivate(user.id);
            await Promise.all([loadUsers(), loadUserStats()]);
            toast.success("Subscription ended and devices deactivated");
        } catch (e) {
            toast.error(getErrorMessage(e, "Failed to end subscription"));
        }
    };

    const handleDelete = async (user: User) => {
        if (!canDeleteUser) {
            toast.error("Only Super Admins can delete users");
            return;
        }
        const ok = await confirm({
            title: "Delete user?",
            message: `PERMANENTLY DELETE ${user.email}?\n\n${DELETE_USER_CONFIRM_MESSAGE}`,
            confirmLabel: "Delete",
            variant: "destructive",
        });
        if (!ok) return;
        try {
            await UsersService.delete(user.id);
            if (users.length === 1 && page > 1) {
                setPage(page - 1); // effect refetches
            } else {
                await loadUsers();
            }
            loadUserStats();
            toast.success("User deleted successfully");
        } catch (e) {
            toast.error(getErrorMessage(e, "Failed to delete user"));
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">User Management</h2>
                    <p className="text-muted-foreground">Manage accounts, subscriptions, and permissions.</p>
                </div>
            </div>

            {/* User Stats Cards */}
            {loadingStats ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="p-6 rounded-xl border border-border bg-card animate-pulse">
                            <div className="h-4 bg-muted rounded w-1/2 mb-2"></div>
                            <div className="h-8 bg-muted rounded w-3/4 mt-2"></div>
                        </div>
                    ))}
                </div>
            ) : statsError ? (
                <div className="rounded-xl border border-border bg-card">
                    <ErrorState className="p-6" message={statsError} onRetry={loadUserStats} />
                </div>
            ) : userStats ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <div className="p-6 rounded-xl border border-border bg-card text-card-foreground shadow-sm">
                        <div className="flex items-center gap-2 mb-2">
                            <UsersIcon className="w-4 h-4 text-muted-foreground" />
                            <div className="text-sm font-medium text-muted-foreground">Total Users</div>
                        </div>
                        <div className="text-2xl font-bold">{userStats.totalUsers}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                            {userStats.verifiedUsers} verified, {userStats.unverifiedUsers} unverified
                        </div>
                    </div>

                    <div className="p-6 rounded-xl border border-border bg-card text-card-foreground shadow-sm">
                        <div className="flex items-center gap-2 mb-2">
                            <UserCheck className="w-4 h-4 text-muted-foreground" />
                            <div className="text-sm font-medium text-muted-foreground">Active Subscriptions</div>
                        </div>
                        <div className="text-2xl font-bold">{userStats.activeSubscriptions}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                            {planCount(userStats, "PRO")} PRO, {planCount(userStats, "CREATOR")} Creator
                        </div>
                    </div>

                    <div className="p-6 rounded-xl border border-border bg-card text-card-foreground shadow-sm">
                        <div className="flex items-center gap-2 mb-2">
                            <TrendingUp className="w-4 h-4 text-muted-foreground" />
                            <div className="text-sm font-medium text-muted-foreground">Voice Profiles</div>
                        </div>
                        <div className="text-2xl font-bold">{userStats.totalVoiceProfiles}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                            Avg {Number(userStats.averageVoiceProfilesPerUser || 0).toFixed(1)} per user
                        </div>
                    </div>

                    <div className="p-6 rounded-xl border border-border bg-card text-card-foreground shadow-sm">
                        <div className="flex items-center gap-2 mb-2">
                            <TrendingUp className="w-4 h-4 text-muted-foreground" />
                            <div className="text-sm font-medium text-muted-foreground">Story Progress</div>
                        </div>
                        <div className="text-2xl font-bold">{userStats.totalStoryProgress}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                            Total listening sessions
                        </div>
                    </div>
                </div>
            ) : null}

            {/* Filters & Search */}
            <div className="flex items-center gap-4 bg-card p-4 rounded-xl border border-border">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search users by email..."
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        className="w-full bg-background border border-border rounded-md pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                </div>
            </div>

            <div className="border border-border rounded-xl bg-card overflow-hidden min-h-[300px]">
                {error ? (
                    <ErrorState message={error} onRetry={loadUsers} />
                ) : (
                    <>
                        <table className="w-full text-sm text-left">
                            <thead className="bg-muted/50 text-muted-foreground border-b border-border">
                                <tr>
                                    <th className="px-6 py-3 font-medium">User</th>
                                    <th className="px-6 py-3 font-medium">Subscription</th>
                                    <th className="px-6 py-3 font-medium">Verified</th>
                                    <th className="px-6 py-3 font-medium">Provider</th>
                                    <th className="px-6 py-3 font-medium">Joined</th>
                                    <th className="px-6 py-3 font-medium text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {loading ? (
                                    <tr><td colSpan={6} className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></td></tr>
                                ) : users.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="p-10 text-center text-muted-foreground">
                                            {search ? `No users match "${search}".` : "No users yet."}
                                        </td>
                                    </tr>
                                ) : (
                                    users.map((user) => (
                                        <tr
                                            key={user.id}
                                            onClick={() => router.push(`/users/${user.id}`)}
                                            className="hover:bg-muted/30 transition-colors cursor-pointer"
                                        >
                                            <td className="px-6 py-4">
                                                <div className="font-medium">{user.email}</div>
                                                {user.firstName && (
                                                    <div className="text-xs text-muted-foreground">
                                                        {user.firstName} {user.lastName}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                {user.subscription ? (
                                                    <>
                                                        <span className={cn(
                                                            "px-2 py-1 rounded-full text-xs font-semibold",
                                                            user.subscription.plan === "FREE"
                                                                ? "bg-gray-500/10 text-gray-500"
                                                                : user.subscription.plan === "PRO"
                                                                ? "bg-blue-500/10 text-blue-500"
                                                                : "bg-purple-500/10 text-purple-500"
                                                        )}>
                                                            {user.subscription.plan}
                                                        </span>
                                                        {user.subscription.status !== "ACTIVE" && (
                                                            <span className="ml-2 text-xs text-muted-foreground">
                                                                ({user.subscription.status})
                                                            </span>
                                                        )}
                                                    </>
                                                ) : (
                                                    <span className="text-muted-foreground text-xs">No Subscription</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={cn(
                                                    "px-2 py-1 rounded-full text-xs font-semibold",
                                                    user.emailVerified
                                                        ? "bg-green-500/10 text-green-500"
                                                        : "bg-yellow-500/10 text-yellow-500"
                                                )}>
                                                    {user.emailVerified ? "Yes" : "No"}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-sm text-muted-foreground">
                                                {user.provider}
                                            </td>
                                            <td className="px-6 py-4 text-muted-foreground text-sm">
                                                {new Date(user.createdAt).toLocaleDateString()}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex justify-end gap-2">
                                                    {canDeactivateUser && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleEndSubscription(user);
                                                            }}
                                                            title="End subscription (does not block login)"
                                                            aria-label="End subscription"
                                                            className="text-muted-foreground hover:text-yellow-500 transition-colors p-1"
                                                        >
                                                            <Ban className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                    {canDeleteUser && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleDelete(user);
                                                            }}
                                                            title="Delete user (Super Admin only)"
                                                            aria-label="Delete user"
                                                            className="text-muted-foreground hover:text-destructive transition-colors p-1"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                        <Pagination
                            className="border-t border-border"
                            page={page}
                            totalPages={totalPages}
                            total={total}
                            itemLabel="users"
                            onPageChange={setPage}
                            disabled={loading}
                        />
                    </>
                )}
            </div>
        </div>
    );
}
