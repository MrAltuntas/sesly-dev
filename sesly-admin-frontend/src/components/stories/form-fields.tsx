"use client";

import { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EnumOption, StoryStatus } from "@/types/api.types";

export const inputClass =
    "w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none disabled:opacity-50";

const invalidClass = "border-destructive focus:ring-destructive";
const missingClass = "border-amber-500/70";

interface ShellProps {
    label: string;
    htmlFor?: string;
    hint?: string;
    /** API or client validation message shown under the input. */
    error?: string | null;
    children: ReactNode;
    className?: string;
}

export function FieldShell({ label, htmlFor, hint, error, children, className }: ShellProps) {
    return (
        <div className={className}>
            <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground mb-1.5 block">
                {label}
            </label>
            {children}
            {error ? (
                <p role="alert" className="text-xs text-red-400 mt-1 flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" />
                    {error}
                </p>
            ) : hint ? (
                <p className="text-xs text-muted-foreground mt-1">{hint}</p>
            ) : null}
        </div>
    );
}

interface BaseFieldProps {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    hint?: string;
    error?: string | null;
    /** Needed before the story can be published and still empty. */
    missing?: boolean;
    disabled?: boolean;
    className?: string;
}

interface TextFieldProps extends BaseFieldProps {
    type?: "text" | "url" | "date";
    inputMode?: "text" | "numeric" | "url";
    placeholder?: string;
    maxLength?: number;
}

export function TextField({
    id,
    label,
    value,
    onChange,
    hint,
    error,
    missing,
    disabled,
    className,
    type = "text",
    inputMode,
    placeholder,
    maxLength,
}: TextFieldProps) {
    return (
        <FieldShell label={label} htmlFor={id} hint={hint} error={error} className={className}>
            <input
                id={id}
                type={type}
                inputMode={inputMode}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                maxLength={maxLength}
                disabled={disabled}
                aria-invalid={error ? true : undefined}
                className={cn(inputClass, missing && missingClass, error && invalidClass)}
            />
        </FieldShell>
    );
}

interface TextAreaFieldProps extends BaseFieldProps {
    rows?: number;
    maxLength?: number;
    placeholder?: string;
}

export function TextAreaField({
    id,
    label,
    value,
    onChange,
    hint,
    error,
    missing,
    disabled,
    className,
    rows = 3,
    maxLength,
    placeholder,
}: TextAreaFieldProps) {
    return (
        <FieldShell label={label} htmlFor={id} hint={hint} error={error} className={className}>
            <textarea
                id={id}
                rows={rows}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                maxLength={maxLength}
                placeholder={placeholder}
                disabled={disabled}
                aria-invalid={error ? true : undefined}
                className={cn(inputClass, "resize-y leading-relaxed", missing && missingClass, error && invalidClass)}
            />
        </FieldShell>
    );
}

interface SelectFieldProps extends BaseFieldProps {
    options: EnumOption[];
    /** Label of the empty choice. Leave out when a value is mandatory. */
    emptyLabel?: string;
}

export function SelectField({
    id,
    label,
    value,
    onChange,
    hint,
    error,
    missing,
    disabled,
    className,
    options,
    emptyLabel,
}: SelectFieldProps) {
    // A saved value the metadata does not list (older row, newer backend) must
    // stay selectable, otherwise the select would silently show another value.
    const known = value === "" || options.some((option) => option.value === value);
    return (
        <FieldShell label={label} htmlFor={id} hint={hint} error={error} className={className}>
            <select
                id={id}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                aria-invalid={error ? true : undefined}
                className={cn(inputClass, missing && missingClass, error && invalidClass)}
            >
                {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
                {!known && <option value={value}>{value}</option>}
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        </FieldShell>
    );
}

// ---------- Badges shared by the list, the editor and the task views ----------

const STATUS_CLASSES: Record<StoryStatus, string> = {
    DRAFT: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    PUBLISHED: "bg-green-500/10 text-green-400 border-green-500/30",
    ARCHIVED: "bg-muted/40 text-muted-foreground border-border",
};

export function StatusBadge({ status, label }: { status: StoryStatus; label: string }) {
    return (
        <span
            className={cn(
                "inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium whitespace-nowrap",
                STATUS_CLASSES[status] ?? STATUS_CLASSES.ARCHIVED,
            )}
        >
            {label}
        </span>
    );
}

export function LanguageBadge({ code, title, muted }: { code: string; title?: string; muted?: boolean }) {
    return (
        <span
            title={title}
            className={cn(
                "inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-semibold uppercase tracking-wide",
                muted
                    ? "border-border text-muted-foreground"
                    : "border-primary/40 bg-primary/10 text-primary",
            )}
        >
            {code}
        </span>
    );
}
