"use client";

import { useCallback, useEffect, useState } from "react";
import { AnalyticsService } from "@/services/admin.service";
import { SystemStats, RecentActivity, UsageStats } from "@/types/api.types";
import { Loader2, Activity, TrendingUp } from "lucide-react";
import { ErrorState, getErrorMessage } from "@/components/ui/error-state";

function formatMoney(amount: number, currency: string): string {
    try {
        return new Intl.NumberFormat("tr-TR", {
            style: "currency",
            currency,
            maximumFractionDigits: 2,
        }).format(amount);
    } catch {
        // Unknown currency code: fall back to "1234.50 XYZ".
        return `${amount.toFixed(2)} ${currency}`;
    }
}

export default function DashboardPage() {
    const [stats, setStats] = useState<SystemStats | null>(null);
    const [activity, setActivity] = useState<RecentActivity | null>(null);
    const [usage, setUsage] = useState<UsageStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadDashboardData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [statsRes, activityRes, usageRes] = await Promise.all([
                AnalyticsService.getSystemStats(),
                AnalyticsService.getRecentActivity({ limit: 5 }),
                AnalyticsService.getUsageStats(),
            ]);
            setStats(statsRes.data);
            setActivity(activityRes.data);
            setUsage(usageRes.data);
        } catch (e) {
            console.error("Failed to load dashboard data", e);
            setError(getErrorMessage(e, "Could not load dashboard data."));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadDashboardData();
    }, [loadDashboardData]);

    if (loading) {
        return (
            <div className="flex h-[50vh] items-center justify-center text-muted-foreground">
                <Loader2 className="w-8 h-8 animate-spin" />
            </div>
        );
    }

    if (error || !stats) {
        return (
            <div className="space-y-6">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Overview</h2>
                </div>
                <div className="rounded-xl border border-border bg-card">
                    <ErrorState message={error ?? "Could not load dashboard data."} onRetry={loadDashboardData} />
                </div>
            </div>
        );
    }

    const currency = stats.subscriptions.currency || "TRY";
    const revenue = formatMoney(stats.subscriptions.estimatedMonthlyRevenue ?? 0, currency);
    const averagePerUser = Number(usage?.averageStoriesPerUser ?? 0);

    const statCards = [
        {
            label: "Total Users",
            value: stats.users.total,
            subtext: `${stats.users.verified} verified`,
        },
        {
            label: "Total Stories",
            value: stats.stories.total,
            subtext: `${stats.stories.premium} premium`,
        },
        {
            label: "Active Subscriptions",
            value: stats.subscriptions.total,
            subtext: `${stats.subscriptions.paid ?? 0} paid, est. ${revenue}/mo`,
        },
        {
            label: "Audio Files",
            value: stats.audio.total,
            // successRate already ends with "%".
            subtext: `${stats.audio.successRate || "0%"} success`,
        },
    ];

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Overview</h2>
                <p className="text-muted-foreground">Welcome back to mission control.</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {statCards.map((stat) => (
                    <div key={stat.label} className="p-6 rounded-xl border border-border bg-card text-card-foreground shadow-sm">
                        <div className="text-sm font-medium text-muted-foreground">{stat.label}</div>
                        <div className="text-2xl font-bold mt-2">{stat.value}</div>
                        <div className="text-xs text-muted-foreground mt-1">{stat.subtext}</div>
                    </div>
                ))}
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                {/* Recent Activity Widget */}
                <div className="col-span-4 rounded-xl border border-border bg-card p-6">
                    <div className="flex items-center gap-2 mb-4">
                        <Activity className="w-5 h-5 text-primary" />
                        <h3 className="font-semibold text-lg">Recent Activity</h3>
                    </div>

                    {activity && (
                        <div className="space-y-4">
                            <div>
                                <h4 className="text-sm font-medium text-muted-foreground mb-2">New Users</h4>
                                <div className="space-y-2">
                                    {activity.recentUsers.data.length > 0 ? (
                                        activity.recentUsers.data.map((user) => (
                                            <div key={user.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                                                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                                                    <span className="text-xs font-medium">{user.email[0]?.toUpperCase()}</span>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium truncate">{user.firstName || user.email}</p>
                                                    <p className="text-xs text-muted-foreground">{new Date(user.createdAt).toLocaleDateString()}</p>
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="text-sm text-muted-foreground">No recent users</p>
                                    )}
                                </div>
                            </div>

                            <div>
                                <h4 className="text-sm font-medium text-muted-foreground mb-2">New Stories</h4>
                                <div className="space-y-2">
                                    {activity.recentStories.data.length > 0 ? (
                                        activity.recentStories.data.map((story) => (
                                            <div key={story.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 transition-colors">
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium truncate">{story.title}</p>
                                                    <p className="text-xs text-muted-foreground">{story.category.replace(/_/g, " ")}</p>
                                                </div>
                                                {story.isPremium && (
                                                    <span className="ml-2 px-2 py-0.5 bg-yellow-500/10 text-yellow-500 text-xs rounded-full">Premium</span>
                                                )}
                                            </div>
                                        ))
                                    ) : (
                                        <p className="text-sm text-muted-foreground">No recent stories</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Usage Stats Widget */}
                <div className="col-span-3 rounded-xl border border-border bg-card p-6">
                    <div className="flex items-center gap-2 mb-4">
                        <TrendingUp className="w-5 h-5 text-primary" />
                        <h3 className="font-semibold text-lg">Usage Stats</h3>
                    </div>

                    {usage && (
                        <div className="space-y-4">
                            <div className="text-center pb-4 border-b border-border">
                                <p className="text-sm text-muted-foreground">Current Month</p>
                                <p className="text-2xl font-bold mt-1">
                                    {new Date(usage.currentYear, usage.currentMonth - 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                                </p>
                            </div>

                            <div className="space-y-3">
                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-muted-foreground">Stories generated</span>
                                    <span className="text-lg font-semibold">{usage.totalStoriesGenerated}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-muted-foreground">Premium voice narrations</span>
                                    <span className="text-sm font-medium">{usage.premiumNarrations}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-muted-foreground">Standard voice narrations</span>
                                    <span className="text-sm font-medium">{usage.standardNarrations}</span>
                                </div>
                                <div className="flex justify-between items-center pt-3 border-t border-border">
                                    <span className="text-sm text-muted-foreground">Active Users</span>
                                    <span className="text-lg font-semibold">{usage.activeUsers}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-muted-foreground">Avg stories/user</span>
                                    <span className="text-sm font-medium">
                                        {Number.isFinite(averagePerUser) ? averagePerUser.toFixed(1) : "-"}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
