"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Ban, Trash2, Mail, Shield, Smartphone, BookOpen, Mic, Heart } from "lucide-react";
import { UsersService } from "@/services/admin.service";
import { SubscriptionPlan, UserDetail } from "@/types/api.types";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { usePermissions } from "@/hooks/usePermissions";
import { ErrorState, getErrorMessage } from "@/components/ui/error-state";
import { END_SUBSCRIPTION_CONFIRM_MESSAGE, DELETE_USER_CONFIRM_MESSAGE } from "@/lib/user-actions";
import { cn } from "@/lib/utils";

export default function UserDetailPage() {
    const params = useParams();
    const router = useRouter();
    const userId = params.id as string;
    const [user, setUser] = useState<UserDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
    const toast = useToast();
    const confirm = useConfirm();
    const { canDeactivateUser, canDeleteUser } = usePermissions();

    const loadUserDetail = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await UsersService.getById(userId);
            setUser(res.data);
        } catch (e: unknown) {
            console.error("Failed to load user details", e);
            const status = (e as { response?: { status?: number } })?.response?.status;
            setUser(null);
            setError({
                message: getErrorMessage(e, "Could not load user details."),
                notFound: status === 404,
            });
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        loadUserDetail();
    }, [loadUserDetail]);

    const handleEndSubscription = async () => {
        if (!canDeactivateUser || !user) return;
        const ok = await confirm({
            title: `End subscription for ${user.email}?`,
            message: END_SUBSCRIPTION_CONFIRM_MESSAGE,
            confirmLabel: "End subscription",
            variant: "destructive",
        });
        if (!ok) return;

        try {
            await UsersService.deactivate(user.id);
            toast.success("Subscription ended and devices deactivated");
            await loadUserDetail();
        } catch (e: unknown) {
            toast.error(getErrorMessage(e, "Failed to end subscription"));
        }
    };

    const handleDelete = async () => {
        if (!canDeleteUser || !user) return;
        const ok = await confirm({
            title: "Delete user?",
            message: `PERMANENTLY DELETE ${user.email}?\n\n${DELETE_USER_CONFIRM_MESSAGE}`,
            confirmLabel: "Delete",
            variant: "destructive",
        });
        if (!ok) return;

        try {
            await UsersService.delete(user.id);
            toast.success("User deleted");
            router.push("/users");
        } catch (e: unknown) {
            toast.error(getErrorMessage(e, "Failed to delete user"));
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-[50vh]">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!user) {
        return (
            <div className="text-center py-12">
                {error && !error.notFound ? (
                    <ErrorState message={error.message} onRetry={loadUserDetail} />
                ) : (
                    <p className="text-muted-foreground">User not found</p>
                )}
                <button
                    onClick={() => router.push("/users")}
                    className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md"
                >
                    Back to Users
                </button>
            </div>
        );
    }

    const currentUsage = user.usageLimits?.[0];
    const isFreePlan = !user.subscription || user.subscription.plan === SubscriptionPlan.FREE;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => router.push("/users")}
                        className="p-2 hover:bg-muted rounded-lg transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div>
                        <h2 className="text-3xl font-bold tracking-tight">User Details</h2>
                        <p className="text-muted-foreground">{user.email}</p>
                    </div>
                </div>

                <div className="flex gap-2">
                    {canDeactivateUser && (
                        <button
                            onClick={handleEndSubscription}
                            title="Expires the subscription and disables push devices. Does not block login."
                            className="px-4 py-2 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 rounded-lg flex items-center gap-2 transition-colors"
                        >
                            <Ban className="w-4 h-4" />
                            End subscription
                        </button>
                    )}
                    {canDeleteUser && (
                        <button
                            onClick={handleDelete}
                            className="px-4 py-2 bg-destructive/10 text-destructive hover:bg-destructive/20 rounded-lg flex items-center gap-2 transition-colors"
                        >
                            <Trash2 className="w-4 h-4" />
                            Delete
                        </button>
                    )}
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {/* User Info Card */}
                <div className="p-6 rounded-xl border border-border bg-card">
                    <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                        <Mail className="w-5 h-5" />
                        User Information
                    </h3>
                    <div className="space-y-3">
                        <div>
                            <p className="text-sm text-muted-foreground">Name</p>
                            <p className="font-medium">
                                {user.firstName || user.lastName
                                    ? `${user.firstName || ""} ${user.lastName || ""}`.trim()
                                    : "Not set"}
                            </p>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">Email</p>
                            <p className="font-medium">{user.email}</p>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">Provider</p>
                            <span className="px-2 py-1 bg-muted rounded-full text-xs font-semibold">
                                {user.provider}
                            </span>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">Email Verified</p>
                            <span
                                className={cn(
                                    "px-2 py-1 rounded-full text-xs font-semibold",
                                    user.emailVerified
                                        ? "bg-green-500/10 text-green-500"
                                        : "bg-yellow-500/10 text-yellow-500"
                                )}
                            >
                                {user.emailVerified ? "Yes" : "No"}
                            </span>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">Joined</p>
                            <p className="font-medium">{new Date(user.createdAt).toLocaleDateString()}</p>
                        </div>
                    </div>
                </div>

                {/* Subscription Card */}
                <div className="p-6 rounded-xl border border-border bg-card">
                    <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                        <Shield className="w-5 h-5" />
                        Subscription
                    </h3>
                    {user.subscription ? (
                        <div className="space-y-3">
                            <div>
                                <p className="text-sm text-muted-foreground">Plan</p>
                                <span
                                    className={cn(
                                        "px-2 py-1 rounded-full text-xs font-semibold",
                                        user.subscription.plan === "FREE"
                                            ? "bg-gray-500/10 text-gray-500"
                                            : user.subscription.plan === "PRO"
                                                ? "bg-blue-500/10 text-blue-500"
                                                : "bg-purple-500/10 text-purple-500"
                                    )}
                                >
                                    {user.subscription.plan}
                                </span>
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Status</p>
                                <span
                                    className={cn(
                                        "px-2 py-1 rounded-full text-xs font-semibold",
                                        user.subscription.status === "ACTIVE"
                                            ? "bg-green-500/10 text-green-500"
                                            : "bg-red-500/10 text-red-500"
                                    )}
                                >
                                    {user.subscription.status}
                                </span>
                            </div>
                            {user.subscription.currentPeriodStart && (
                                <div>
                                    <p className="text-sm text-muted-foreground">Period Start</p>
                                    <p className="font-medium">
                                        {new Date(user.subscription.currentPeriodStart).toLocaleDateString()}
                                    </p>
                                </div>
                            )}
                            {user.subscription.currentPeriodEnd && (
                                <div>
                                    <p className="text-sm text-muted-foreground">Period End</p>
                                    <p className="font-medium">
                                        {new Date(user.subscription.currentPeriodEnd).toLocaleDateString()}
                                    </p>
                                </div>
                            )}
                            <div>
                                <p className="text-sm text-muted-foreground">Cancel at Period End</p>
                                <p className="font-medium">{user.subscription.cancelAtPeriodEnd ? "Yes" : "No"}</p>
                            </div>
                        </div>
                    ) : (
                        <p className="text-muted-foreground">No active subscription</p>
                    )}
                </div>

                {/* Usage Limits */}
                <div className="p-6 rounded-xl border border-border bg-card">
                    <h3 className="font-semibold text-lg mb-4">This Month</h3>
                    {currentUsage ? (
                        <div className="p-3 rounded-lg border border-border space-y-1">
                            <p className="text-sm font-medium">
                                {currentUsage.month}/{currentUsage.year}
                            </p>
                            <p className="text-sm">
                                <span className="text-muted-foreground">Narrations counted toward the free quota: </span>
                                <span className="font-medium">{currentUsage.storiesGenerated}</span>
                            </p>
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            {isFreePlan
                                ? "No narrations counted toward the free quota this month."
                                : "Not tracked: the monthly quota counter only records free-plan narrations."}
                        </p>
                    )}
                </div>
            </div>

            {/* Voice Profiles */}
            <div className="p-6 rounded-xl border border-border bg-card">
                <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                    <Mic className="w-5 h-5" />
                    Voice Profiles ({user.voiceProfiles.length})
                </h3>
                {user.voiceProfiles.length > 0 ? (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {user.voiceProfiles.map((profile) => (
                            <div
                                key={profile.id}
                                className="p-4 rounded-lg border border-border bg-muted/30"
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <p className="font-medium">{profile.name}</p>
                                    <span
                                        className={cn(
                                            "px-2 py-0.5 rounded-full text-xs font-semibold",
                                            profile.status === "READY"
                                                ? "bg-green-500/10 text-green-500"
                                                : profile.status === "PENDING"
                                                    ? "bg-yellow-500/10 text-yellow-500"
                                                    : "bg-red-500/10 text-red-500"
                                        )}
                                    >
                                        {profile.status}
                                    </span>
                                </div>
                                <p className="text-xs text-muted-foreground">Provider: {profile.provider}</p>
                                <p className="text-xs text-muted-foreground">
                                    Created: {new Date(profile.createdAt).toLocaleDateString()}
                                </p>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-muted-foreground">No voice profiles</p>
                )}
            </div>

            {/* Stats Summary */}
            <div className="grid gap-6 md:grid-cols-2">
                <div className="p-6 rounded-xl border border-border bg-card">
                    <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                        <BookOpen className="w-5 h-5" />
                        Story Progress
                    </h3>
                    <p className="text-3xl font-bold">{user._count?.storyProgress ?? 0}</p>
                    <p className="text-sm text-muted-foreground">Stories in progress</p>
                </div>
                <div className="p-6 rounded-xl border border-border bg-card">
                    <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                        <Heart className="w-5 h-5" />
                        Favorite Stories
                    </h3>
                    <p className="text-3xl font-bold">{user._count?.favoriteStories ?? 0}</p>
                    <p className="text-sm text-muted-foreground">Favorited stories</p>
                </div>
            </div>

            {/* Devices */}
            <div className="p-6 rounded-xl border border-border bg-card">
                <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                    <Smartphone className="w-5 h-5" />
                    Devices ({user.devices.length})
                </h3>
                {user.devices.length > 0 ? (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        {user.devices.map((device) => (
                            <div key={device.id} className="p-4 rounded-lg border border-border">
                                <p className="font-medium text-sm mb-1">{device.platform}</p>
                                <p className="text-xs text-muted-foreground mb-1">
                                    ID: {device.id.substring(0, 12)}...
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    Is active: {device.isActive ? "Yes" : "No"}
                                </p>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-muted-foreground">No devices</p>
                )}
            </div>
        </div>
    );
}
