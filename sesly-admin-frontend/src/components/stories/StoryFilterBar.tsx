"use client";

import { useEffect, useState } from "react";
import { FilterX, Search } from "lucide-react";
import type { EnumOption, StoriesMeta } from "@/types/api.types";
import { StoryFilters, activeStoryFilterCount } from "@/lib/stories";
import { cn } from "@/lib/utils";

const SEARCH_DEBOUNCE_MS = 350;

const IMPORTED_OPTIONS: EnumOption[] = [
    { value: "yes", label: "Toplu aktarımla gelenler" },
    { value: "no", label: "Aktarımla gelmeyenler" },
];

const dateClass =
    "bg-background border border-border rounded-md px-2 py-1 text-xs text-foreground focus:ring-2 focus:ring-primary focus:outline-none disabled:opacity-50";

const selectClass =
    "bg-background border border-border rounded-md px-2 py-1.5 text-xs focus:ring-2 focus:ring-primary focus:outline-none disabled:opacity-50 max-w-[11rem]";

interface Props {
    meta: StoriesMeta | null;
    filters: StoryFilters;
    /** Merges into the filters. The page resets to the first page itself. */
    onChange: (changes: Partial<StoryFilters>) => void;
    onClear: () => void;
    disabled?: boolean;
}

interface FilterSelectProps {
    label: string;
    value: string;
    options: EnumOption[];
    allLabel: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    active?: boolean;
}

function FilterSelect({ label, value, options, allLabel, onChange, disabled, active }: FilterSelectProps) {
    // A value from a hand-edited URL that the metadata does not list stays
    // visible, so the admin can see what is filtering the list.
    const known = value === "" || options.some((option) => option.value === value);
    return (
        <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
            {label}
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                className={cn(selectClass, "text-foreground", (active ?? value !== "") && "border-primary/60")}
            >
                <option value="">{allLabel}</option>
                {!known && <option value={value}>{value}</option>}
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        </label>
    );
}

export function StoryFilterBar({ meta, filters, onChange, onClear, disabled }: Props) {
    // The search box keeps its own text and pushes it to the URL after a
    // pause. The URL answers a moment later, possibly after more typing, so
    // the text is only replaced when the URL changes to something we did not
    // push ourselves (filters cleared, back button).
    const [draftQ, setDraftQ] = useState(filters.q);
    const [seenQ, setSeenQ] = useState(filters.q);
    const [pushedQ, setPushedQ] = useState<string | null>(null);
    if (filters.q !== seenQ) {
        setSeenQ(filters.q);
        if (filters.q !== pushedQ) setDraftQ(filters.q);
    }

    useEffect(() => {
        const next = draftQ.trim();
        if (next === filters.q) return;
        const timer = setTimeout(() => {
            setPushedQ(next);
            onChange({ q: next });
        }, SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [draftQ, filters.q, onChange]);

    const languageOptions: EnumOption[] = (meta?.languages.all ?? []).map((language) => ({
        value: language.code,
        label: `${language.nativeName} (${language.code})${language.enabled ? "" : ", kapalı"}`,
    }));
    const enums = meta?.enums;
    const levels = enums?.languageLevel ?? [];
    const activeCount = activeStoryFilterCount(filters);

    const toggleLevel = (level: string) => {
        const next = filters.levels.includes(level)
            ? filters.levels.filter((item) => item !== level)
            : [...filters.levels, level];
        // Keep the order of the metadata so the URL does not depend on click order.
        onChange({ levels: levels.map((option) => option.value).filter((value) => next.includes(value)) });
    };

    return (
        <div className="border border-border rounded-xl bg-card p-3 flex flex-wrap items-end gap-x-3 gap-y-2 shrink-0">
            <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
                Ara
                <span className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                        type="search"
                        value={draftQ}
                        onChange={(e) => setDraftQ(e.target.value)}
                        maxLength={200}
                        placeholder="Başlık ya da metin"
                        className="bg-background border border-border rounded-md pl-7 pr-2 py-1.5 text-xs text-foreground w-48 focus:ring-2 focus:ring-primary focus:outline-none"
                    />
                </span>
            </label>

            <FilterSelect
                label="Dil"
                value={filters.language}
                options={languageOptions}
                allLabel="Tüm diller"
                onChange={(language) => onChange({ language })}
                disabled={disabled}
            />
            <FilterSelect
                label="Durum"
                value={filters.status}
                options={enums?.status ?? []}
                allLabel="Tüm durumlar"
                onChange={(status) => onChange({ status })}
                disabled={disabled}
            />

            <div className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
                Seviye
                <div className="flex gap-1" role="group" aria-label="Dil seviyesi">
                    {levels.length === 0 ? (
                        <span className="text-xs py-1.5">Yok</span>
                    ) : (
                        levels.map((level) => {
                            const on = filters.levels.includes(level.value);
                            return (
                                <button
                                    key={level.value}
                                    type="button"
                                    onClick={() => toggleLevel(level.value)}
                                    disabled={disabled}
                                    aria-pressed={on}
                                    title={level.label}
                                    className={cn(
                                        "px-2 py-1.5 rounded-md border text-xs font-medium transition-colors disabled:opacity-50",
                                        on
                                            ? "bg-primary text-white border-primary"
                                            : "border-border text-foreground hover:bg-muted",
                                    )}
                                >
                                    {level.value}
                                </button>
                            );
                        })
                    )}
                </div>
            </div>

            <FilterSelect
                label="Kategori"
                value={filters.category}
                options={enums?.category ?? []}
                allLabel="Tüm kategoriler"
                onChange={(category) => onChange({ category })}
                disabled={disabled}
            />
            <FilterSelect
                label="Yaş grubu"
                value={filters.ageGroup}
                options={enums?.ageGroup ?? []}
                allLabel="Tüm yaşlar"
                onChange={(ageGroup) => onChange({ ageGroup })}
                disabled={disabled}
            />
            <FilterSelect
                label="Köken"
                value={filters.origin}
                options={enums?.origin ?? []}
                allLabel="Tüm kökenler"
                onChange={(origin) => onChange({ origin })}
                disabled={disabled}
            />
            <FilterSelect
                label="Aktarım"
                value={filters.imported}
                options={IMPORTED_OPTIONS}
                allLabel="Fark etmez"
                onChange={(imported) => onChange({ imported })}
                disabled={disabled}
            />
            <div className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
                Oluşturulma tarihi
                <span className="flex items-center gap-1">
                    <input
                        type="date"
                        aria-label="Oluşturulma tarihi, başlangıç"
                        value={filters.createdFrom}
                        max={filters.createdTo || undefined}
                        onChange={(e) => onChange({ createdFrom: e.target.value })}
                        disabled={disabled}
                        className={cn(dateClass, filters.createdFrom && "border-primary/60")}
                    />
                    <span>ile</span>
                    <input
                        type="date"
                        aria-label="Oluşturulma tarihi, bitiş"
                        value={filters.createdTo}
                        min={filters.createdFrom || undefined}
                        onChange={(e) => onChange({ createdTo: e.target.value })}
                        disabled={disabled}
                        className={cn(dateClass, filters.createdTo && "border-primary/60")}
                    />
                </span>
            </div>
            <FilterSelect
                label="Çevirisi eksik"
                value={filters.missingLanguage}
                options={languageOptions}
                allLabel="Fark etmez"
                onChange={(missingLanguage) => onChange({ missingLanguage })}
                disabled={disabled}
            />
            <FilterSelect
                label="Sıralama"
                value={filters.sort}
                options={meta?.sorts ?? []}
                allLabel="Varsayılan"
                onChange={(sort) => onChange({ sort })}
                disabled={disabled}
                active={false}
            />

            {(activeCount > 0 || filters.sort !== "") && (
                <button
                    type="button"
                    onClick={() => {
                        setDraftQ("");
                        setPushedQ(null);
                        onClear();
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs font-medium hover:bg-muted transition-colors"
                >
                    <FilterX className="w-3.5 h-3.5" />
                    Filtreleri temizle{activeCount > 0 ? ` (${activeCount})` : ""}
                </button>
            )}
        </div>
    );
}
