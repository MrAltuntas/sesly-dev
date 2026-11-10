"use client";

import { useState, useEffect, useCallback } from "react";
import { Tag, Plus, CreditCard, History, Bell, Loader2 } from "lucide-react";
import { FinanceService, OpsService } from "@/services/admin.service";
import { CreatePromoCodeDto, GrantAccessDto, BroadcastDto, PromoCode, PromoCodeType, SubscriptionPlan, BroadcastSegment } from "@/types/api.types";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ErrorState, getErrorMessage } from "@/components/ui/error-state";
import { validatePromoCode, validateDuration, validateEmail } from "@/lib/validation";

type PromoStatus = "Active" | "Inactive" | "Expired" | "Used up";

// Mirrors how the backend would treat the code at redemption time:
// isActive flag, expiry date and the usage cap (maxUses null = unlimited).
function promoStatus(code: PromoCode): PromoStatus {
    if (!code.isActive) return "Inactive";
    if (code.expiresAt && new Date(code.expiresAt) <= new Date()) return "Expired";
    if (code.maxUses != null && code.usedCount >= code.maxUses) return "Used up";
    return "Active";
}

const promoStatusClass: Record<PromoStatus, string> = {
    Active: "bg-green-500/10 text-green-500",
    Inactive: "bg-muted text-muted-foreground",
    Expired: "bg-red-500/10 text-red-500",
    "Used up": "bg-yellow-500/10 text-yellow-500",
};

function promoValueText(code: PromoCode): string {
    switch (code.type) {
        case PromoCodeType.PERCENTAGE:
            return `${code.value}% off`;
        case PromoCodeType.FIXED_AMOUNT:
            return `${code.value} TRY off`;
        case PromoCodeType.FREE_TRIAL:
            return `${code.value} days free`;
        default:
            return String(code.value);
    }
}

export default function FinancePage() {
    const [promoForm, setPromoForm] = useState<Partial<CreatePromoCodeDto>>({ type: PromoCodeType.PERCENTAGE });
    const [grantForm, setGrantForm] = useState<Partial<GrantAccessDto>>({ plan: SubscriptionPlan.PRO, durationDays: 30 });
    const [broadcastForm, setBroadcastForm] = useState<Partial<BroadcastDto>>({ segment: BroadcastSegment.ALL });
    const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
    const [loadingCodes, setLoadingCodes] = useState(false);
    const [codesError, setCodesError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const toast = useToast();
    const confirm = useConfirm();

    const loadPromoCodes = useCallback(async () => {
        setLoadingCodes(true);
        setCodesError(null);
        try {
            const res = await FinanceService.getPromoCodes();
            setPromoCodes(res.data);
        } catch (e) {
            console.error("Failed to load promo codes", e);
            setPromoCodes([]);
            setCodesError(getErrorMessage(e, "Could not load promo codes."));
        } finally {
            setLoadingCodes(false);
        }
    }, []);

    useEffect(() => {
        loadPromoCodes();
    }, [loadPromoCodes]);

    const handleCreatePromo = async (e: React.FormEvent) => {
        e.preventDefault();

        // Validation
        if (!promoForm.code || !promoForm.type || promoForm.value === undefined) {
            toast.error("Please fill all required fields");
            return;
        }

        const validationError = validatePromoCode(promoForm.code, promoForm.type, promoForm.value);
        if (validationError) {
            toast.error(validationError);
            return;
        }

        setLoading(true);
        try {
            const payload: CreatePromoCodeDto = {
                code: promoForm.code,
                type: promoForm.type,
                value: promoForm.value,
                // Omitted = unlimited (backend stores maxUses as null).
                ...(typeof promoForm.maxUses === "number" ? { maxUses: promoForm.maxUses } : {}),
                ...(promoForm.expiresAt ? { expiresAt: promoForm.expiresAt } : {}),
            };
            await FinanceService.createPromoCode(payload);
            toast.success("Promo code created");
            setPromoForm({ type: PromoCodeType.PERCENTAGE }); // Reset
            await loadPromoCodes(); // Refresh list
        } catch (err) {
            toast.error(getErrorMessage(err, "Error creating code"));
        } finally {
            setLoading(false);
        }
    };

    const handleGrantAccess = async (e: React.FormEvent) => {
        e.preventDefault();

        // Validation
        if (!grantForm.userEmail || !grantForm.plan || !grantForm.durationDays || !grantForm.reason) {
            toast.error("Please fill all required fields");
            return;
        }

        const emailError = validateEmail(grantForm.userEmail);
        if (emailError) {
            toast.error(emailError);
            return;
        }

        const durationError = validateDuration(grantForm.durationDays);
        if (durationError) {
            toast.error(durationError);
            return;
        }

        setLoading(true);
        try {
            await FinanceService.grantAccess(grantForm as GrantAccessDto);
            toast.success("Access granted");
            setGrantForm({ plan: SubscriptionPlan.PRO, durationDays: 30 });
        } catch (err) {
            toast.error(getErrorMessage(err, "Error granting access"));
        } finally {
            setLoading(false);
        }
    };

    const handleBroadcast = async (e: React.FormEvent) => {
        e.preventDefault();

        // Validation
        if (!broadcastForm.title || !broadcastForm.body) {
            toast.error("Please fill all required fields");
            return;
        }

        const ok = await confirm({
            title: "Send broadcast?",
            message:
                "Send this notification to every user in the selected segment?\n\n" +
                "It is stored as an in-app notification. Push delivery depends on the backend push setup.\n\nThis cannot be recalled.",
            confirmLabel: "Send",
        });
        if (!ok) return;

        setLoading(true);
        try {
            const result = await OpsService.sendBroadcast(broadcastForm as BroadcastDto);
            const { count, pushDelivered } = result.data;
            // Push only reaches users who opted in to promo notifications and have a registered device.
            toast.success(
                `In-app notification sent to ${count} users. Push delivered to ${pushDelivered ?? 0} opted-in users.`,
            );
            setBroadcastForm({ segment: BroadcastSegment.ALL });
        } catch (err) {
            toast.error(getErrorMessage(err, "Error sending broadcast"));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Finance & Operations</h2>
                <p className="text-muted-foreground">Manage revenue, vouchers, and user engagement.</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {/* Push Notification Broadcast */}
                <div className="rounded-xl border border-border bg-card p-6 md:col-span-2 lg:col-span-1 order-last lg:order-first">
                    <div className="flex items-center gap-2 mb-6">
                        <div className="p-2 bg-blue-500/10 rounded-lg text-blue-500">
                            <Bell className="w-5 h-5" />
                        </div>
                        <h3 className="font-semibold text-lg">Broadcast Notification</h3>
                    </div>

                    <form onSubmit={handleBroadcast} className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Title</label>
                            <input
                                required
                                onChange={e => setBroadcastForm({ ...broadcastForm, title: e.target.value })}
                                value={broadcastForm.title || ''}
                                type="text" placeholder="New Bedtime Story!"
                                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Body</label>
                            <textarea
                                required
                                onChange={e => setBroadcastForm({ ...broadcastForm, body: e.target.value })}
                                value={broadcastForm.body || ''}
                                placeholder="Discover the magic of..."
                                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm min-h-[80px]"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Target Segment</label>
                            <select
                                onChange={e => setBroadcastForm({ ...broadcastForm, segment: e.target.value as BroadcastSegment })}
                                value={broadcastForm.segment}
                                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                            >
                                <option value="ALL">All Users</option>
                                <option value="PREMIUM">Premium Subscribers</option>
                                <option value="FREE">Free Users</option>
                            </select>
                        </div>
                        <div className="pt-2">
                            <button disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2">
                                Send Broadcast
                            </button>
                        </div>
                    </form>
                </div>

                {/* Create Promo Code */}
                <div className="rounded-xl border border-border bg-card p-6 lg:col-span-1">
                    <div className="flex items-center gap-2 mb-6">
                        <div className="p-2 bg-primary/10 rounded-lg text-primary">
                            <Tag className="w-5 h-5" />
                        </div>
                        <h3 className="font-semibold text-lg">Create Promo Code</h3>
                    </div>

                    <form onSubmit={handleCreatePromo} className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Code</label>
                            <input
                                required
                                onChange={e => setPromoForm({ ...promoForm, code: e.target.value })}
                                value={promoForm.code || ''}
                                type="text" placeholder="SUMMER2025"
                                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Discount Type</label>
                            <select
                                onChange={e => setPromoForm({ ...promoForm, type: e.target.value as PromoCodeType })}
                                value={promoForm.type}
                                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                            >
                                <option value="PERCENTAGE">Percentage (%)</option>
                                <option value="FIXED_AMOUNT">Fixed Amount (TRY)</option>
                                <option value="FREE_TRIAL">Free Trial (Days)</option>
                            </select>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Value</label>
                                <input
                                    required
                                    type="number"
                                    onChange={e => setPromoForm({ ...promoForm, value: Number(e.target.value) })}
                                    value={promoForm.value || ''}
                                    placeholder="20"
                                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Max Uses</label>
                                <input
                                    type="number"
                                    min={1}
                                    onChange={e => setPromoForm({
                                        ...promoForm,
                                        maxUses: e.target.value === '' ? undefined : Number(e.target.value),
                                    })}
                                    value={promoForm.maxUses ?? ''}
                                    placeholder="Unlimited"
                                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                                />
                            </div>
                        </div>

                        <div className="pt-2">
                            <button disabled={loading} className="w-full bg-primary hover:bg-primary/90 text-white py-2 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2">
                                <Plus className="w-4 h-4" /> Create Code
                            </button>
                        </div>
                    </form>
                </div>

                {/* Grant Subscription */}
                <div className="rounded-xl border border-border bg-card p-6 lg:col-span-1">
                    <div className="flex items-center gap-2 mb-6">
                        <div className="p-2 bg-purple-500/10 rounded-lg text-purple-500">
                            <CreditCard className="w-5 h-5" />
                        </div>
                        <h3 className="font-semibold text-lg">Grant Manual Access</h3>
                    </div>

                    <form onSubmit={handleGrantAccess} className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Target User Email</label>
                            <input
                                required
                                type="email"
                                onChange={e => setGrantForm({ ...grantForm, userEmail: e.target.value })}
                                value={grantForm.userEmail || ''}
                                placeholder="user@example.com"
                                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Plan</label>
                                <select
                                    onChange={e => setGrantForm({ ...grantForm, plan: e.target.value as SubscriptionPlan })}
                                    value={grantForm.plan}
                                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                                >
                                    <option value="PRO">PRO Subscription</option>
                                    <option value="CREATOR">CREATOR Subscription</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Duration (Days)</label>
                                <input
                                    required
                                    type="number"
                                    onChange={e => setGrantForm({ ...grantForm, durationDays: Number(e.target.value) })}
                                    value={grantForm.durationDays || ''}
                                    placeholder="30"
                                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Reason (Internal Note)</label>
                            <textarea
                                onChange={e => setGrantForm({ ...grantForm, reason: e.target.value })}
                                value={grantForm.reason || ''}
                                placeholder="e.g. Customer support reimbursement"
                                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm min-h-[80px]"
                            />
                        </div>

                        <div className="pt-2">
                            <button disabled={loading} className="w-full bg-secondary hover:bg-secondary/80 text-secondary-foreground py-2 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2">
                                Grant Access
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            {/* Recent Codes Table */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="p-6 border-b border-border flex items-center gap-2">
                    <History className="w-5 h-5 text-muted-foreground" />
                    <h3 className="font-semibold">Promo Codes</h3>
                </div>
                <table className="w-full text-sm text-left">
                    <thead className="bg-muted/50 text-muted-foreground">
                        <tr>
                            <th className="px-6 py-3 font-medium">Code</th>
                            <th className="px-6 py-3 font-medium">Type</th>
                            <th className="px-6 py-3 font-medium">Uses</th>
                            <th className="px-6 py-3 font-medium">Expires</th>
                            <th className="px-6 py-3 font-medium">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {loadingCodes ? (
                            <tr>
                                <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                                    <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                                    <p className="mt-2 text-sm">Loading promo codes...</p>
                                </td>
                            </tr>
                        ) : codesError ? (
                            <tr>
                                <td colSpan={5}>
                                    <ErrorState message={codesError} onRetry={loadPromoCodes} />
                                </td>
                            </tr>
                        ) : promoCodes.length > 0 ? (
                            promoCodes.map((code) => {
                                const used = code.usedCount ?? 0;
                                const usesText = code.maxUses != null ? `${used} / ${code.maxUses}` : `${used} / unlimited`;
                                const status = promoStatus(code);

                                return (
                                    <tr key={code.id} className="hover:bg-muted/30">
                                        <td className="px-6 py-4 font-mono font-medium">{code.code}</td>
                                        <td className="px-6 py-4">{promoValueText(code)}</td>
                                        <td className="px-6 py-4">{usesText}</td>
                                        <td className="px-6 py-4 text-muted-foreground">
                                            {code.expiresAt ? new Date(code.expiresAt).toLocaleDateString() : "Never"}
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${promoStatusClass[status]}`}>
                                                {status}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })
                        ) : (
                            <tr>
                                <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                                    No promo codes yet. Create one above.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
