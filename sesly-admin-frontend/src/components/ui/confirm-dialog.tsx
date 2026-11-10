"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// ConfirmDialog + useConfirm
//
// Drop-in replacement for native window.confirm() that returns a Promise<boolean>.
// Mount <ConfirmProvider> high in the tree; anywhere below, call
//   const confirm = useConfirm();
//   if (!(await confirm({ title, message, variant: 'destructive' }))) return;
// ─────────────────────────────────────────────────────────────────────────────

export type ConfirmVariant = "default" | "destructive";

export interface ConfirmOptions {
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: ConfirmVariant;
}

interface ConfirmState extends ConfirmOptions {
    resolve: (value: boolean) => void;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<ConfirmState | null>(null);
    const confirmButtonRef = useRef<HTMLButtonElement>(null);

    const confirm = useCallback<ConfirmFn>((options) => {
        return new Promise<boolean>((resolve) => {
            setState({ ...options, resolve });
        });
    }, []);

    const close = useCallback(
        (result: boolean) => {
            setState((prev) => {
                if (prev) prev.resolve(result);
                return null;
            });
        },
        [],
    );

    // Close on Escape, confirm on Enter.
    useEffect(() => {
        if (!state) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                close(false);
            } else if (e.key === "Enter") {
                e.preventDefault();
                close(true);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [state, close]);

    // Autofocus the confirm button when the dialog opens.
    useEffect(() => {
        if (state) {
            // Defer one tick so the element is mounted.
            const t = setTimeout(() => confirmButtonRef.current?.focus(), 0);
            return () => clearTimeout(t);
        }
    }, [state]);

    const value = useMemo(() => confirm, [confirm]);

    return (
        <ConfirmContext.Provider value={value}>
            {children}
            {state && typeof document !== "undefined"
                ? createPortal(
                      <ConfirmDialog
                          state={state}
                          onClose={close}
                          confirmButtonRef={confirmButtonRef}
                      />,
                      document.body,
                  )
                : null}
        </ConfirmContext.Provider>
    );
}

interface ConfirmDialogProps {
    state: ConfirmState;
    onClose: (result: boolean) => void;
    confirmButtonRef: React.RefObject<HTMLButtonElement | null>;
}

function ConfirmDialog({ state, onClose, confirmButtonRef }: ConfirmDialogProps) {
    const variant: ConfirmVariant = state.variant ?? "default";
    const confirmLabel = state.confirmLabel ?? "Confirm";
    const cancelLabel = state.cancelLabel ?? "Cancel";
    const title = state.title ?? (variant === "destructive" ? "Are you sure?" : "Confirm action");

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in"
            onClick={() => onClose(false)}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className="bg-card border border-border rounded-xl w-full max-w-md overflow-hidden shadow-2xl"
            >
                <div className="p-6">
                    <div className="flex items-start gap-4">
                        {variant === "destructive" && (
                            <div className="shrink-0 w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center text-destructive">
                                <AlertTriangle className="w-5 h-5" />
                            </div>
                        )}
                        <div className="flex-1 min-w-0">
                            <h3
                                id="confirm-dialog-title"
                                className="font-semibold text-lg mb-1"
                            >
                                {title}
                            </h3>
                            <p className="text-sm text-muted-foreground whitespace-pre-line">
                                {state.message}
                            </p>
                        </div>
                    </div>
                </div>
                <div className="px-6 py-4 bg-muted/20 border-t border-border flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={() => onClose(false)}
                        className="px-4 py-2 rounded-md text-sm font-medium hover:bg-muted transition-colors"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        ref={confirmButtonRef}
                        type="button"
                        onClick={() => onClose(true)}
                        className={cn(
                            "px-4 py-2 rounded-md text-sm font-medium text-white transition-colors",
                            variant === "destructive"
                                ? "bg-destructive hover:bg-destructive/90"
                                : "bg-primary hover:bg-primary/90",
                        )}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}

export function useConfirm(): ConfirmFn {
    const ctx = useContext(ConfirmContext);
    if (!ctx) {
        throw new Error("useConfirm must be used within <ConfirmProvider>");
    }
    return ctx;
}

/**
 * Runtime-safe wrapper for callers that may render before the provider is
 * mounted (e.g. during SSR hydration): falls back to the native confirm().
 */
export function useSafeConfirm(): ConfirmFn {
    const ctx = useContext(ConfirmContext);
    return useMemo<ConfirmFn>(() => {
        if (ctx) return ctx;
        return async (opts) =>
            typeof window !== "undefined" ? window.confirm(opts.message) : false;
    }, [ctx]);
}

// Spinner export used by consumers that want a loading indicator after
// confirmation — not required, kept here for symmetry/reuse.
export const ConfirmSpinner = Loader2;
