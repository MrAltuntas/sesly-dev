"use client";

import { ShieldAlert } from "lucide-react";
import type { EnumOption } from "@/types/api.types";
import { contentWarningOptions, parseContentWarnings, toggleContentWarning } from "@/lib/stories";

interface Props {
    /**
     * `enums.contentWarning` of the meta endpoint (ContentWarning values with
     * Turkish labels); empty while the meta loads: the local enum is shown.
     */
    options: EnumOption[];
    /** The form value: ContentWarning values separated by commas, enum order. */
    value: string;
    onChange: (value: string) => void;
    error?: string;
    disabled?: boolean;
}

/**
 * "İçerik uyarıları": shown in the app next to the age group, and once
 * before a narration starts, so a parent knows before listening.
 */
export function ContentWarningsField({ options: metaOptions, value, onChange, error, disabled }: Props) {
    const options = contentWarningOptions(metaOptions);
    const selected = new Set(parseContentWarnings(value));
    const order = options.map((o) => o.value);
    return (
        <fieldset className="space-y-2" disabled={disabled}>
            <legend className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" />
                İçerik uyarıları
            </legend>
            <p className="text-xs text-muted-foreground">
                Uygulamada yaş grubunun yanında sakin bir notla gösterilir; seslendirme başlarken ebeveyne bir kez
                hatırlatılır.
            </p>
            <div className="flex flex-wrap gap-2">
                {options.map((option) => {
                    const on = selected.has(option.value);
                    return (
                        <label
                            key={option.value}
                            className={
                                on
                                    ? "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-primary bg-primary/10 text-xs cursor-pointer"
                                    : "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border text-xs cursor-pointer hover:bg-muted"
                            }
                        >
                            <input
                                type="checkbox"
                                className="accent-primary"
                                checked={on}
                                onChange={() => onChange(toggleContentWarning(value, option.value, order))}
                                data-testid={`content-warning-${option.value}`}
                            />
                            {option.label}
                        </label>
                    );
                })}
            </div>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </fieldset>
    );
}
