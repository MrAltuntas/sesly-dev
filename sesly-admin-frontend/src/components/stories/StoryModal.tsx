"use client";

import { ReactNode, useEffect } from "react";
import { X } from "lucide-react";

interface Props {
    title: string;
    subtitle?: string;
    icon?: ReactNode;
    onClose: () => void;
    children: ReactNode;
    /** Blocks closing while a request is in flight. */
    busy?: boolean;
}

/** Modal shell of the stories page, in the visual language of the seed dialog. */
export function StoryModal({ title, subtitle, icon, onClose, children, busy = false }: Props) {
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !busy) onClose();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [busy, onClose]);

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => {
                if (!busy) onClose();
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className="bg-card border border-border rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            >
                <div className="p-5 border-b border-border bg-muted/10 flex justify-between items-start gap-4 shrink-0">
                    <div>
                        <h3 className="text-lg font-bold tracking-tight flex items-center gap-2">
                            {icon}
                            {title}
                        </h3>
                        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        aria-label="Kapat"
                        className="text-muted-foreground hover:text-foreground transition-colors p-2 hover:bg-muted rounded-full disabled:opacity-50"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-5 space-y-4 overflow-y-auto flex-1">{children}</div>
            </div>
        </div>
    );
}
