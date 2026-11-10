"use client";

import { ChangeEvent } from "react";
import { FileJson } from "lucide-react";
import type { CoverCredit } from "@/types/api.types";
import { coverCreditLine, parseCoverCreditText } from "@/lib/covers";
import { inputClass } from "./form-fields";

interface Props {
    value: CoverCredit;
    onChange: (value: CoverCredit) => void;
    /** A message about a credit file that could not be read. */
    onError?: (message: string | null) => void;
    disabled?: boolean;
    idPrefix: string;
}

const FIELDS: Array<{ key: keyof CoverCredit; label: string; placeholder: string; multiline?: boolean }> = [
    { key: "illustrator", label: "Çizer", placeholder: "ör. Vilhelm Pedersen" },
    { key: "licenseName", label: "Lisans", placeholder: "ör. CC BY 4.0 ya da Kamu malı" },
    { key: "licenseUrl", label: "Lisans bağlantısı", placeholder: "https://creativecommons.org/licenses/by/4.0/" },
    { key: "source", label: "Kaynak", placeholder: "Resmin alındığı kitap ya da sayfa" },
    { key: "attribution", label: "Atıf metni", placeholder: "Kaynağın istediği atıf cümlesi (doluysa uygulamada bu gösterilir)", multiline: true },
];

/**
 * Credit of a cover picture. Covers made for Sesly need none; a CC BY or
 * public domain illustration does. A `<slug>.credit.json` fills the fields.
 */
export function CoverCreditFields({ value, onChange, onError, disabled, idPrefix }: Props) {
    const set = (key: keyof CoverCredit, text: string) => {
        const next = { ...value };
        if (text.trim() === "") delete next[key];
        else next[key] = text;
        onChange(next);
    };

    const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        const { credit, error } = parseCoverCreditText(await file.text());
        onError?.(error);
        if (credit) onChange(credit);
    };

    const line = coverCreditLine(value);

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">Kapak resmi künyesi (isteğe bağlı)</span>
                <label className="inline-flex items-center gap-1.5 px-2 py-1 border border-border rounded-md text-xs cursor-pointer hover:bg-muted">
                    <FileJson className="w-3.5 h-3.5" />
                    .credit.json seç
                    <input
                        type="file"
                        accept="application/json,.json"
                        className="hidden"
                        onChange={handleFile}
                        disabled={disabled}
                    />
                </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {FIELDS.map((field) => (
                    <label
                        key={field.key}
                        htmlFor={`${idPrefix}-${field.key}`}
                        className={field.multiline ? "md:col-span-2 text-[11px] text-muted-foreground" : "text-[11px] text-muted-foreground"}
                    >
                        {field.label}
                        {field.multiline ? (
                            <textarea
                                id={`${idPrefix}-${field.key}`}
                                className={`${inputClass} mt-1 text-xs`}
                                rows={3}
                                maxLength={2000}
                                value={value[field.key] ?? ""}
                                placeholder={field.placeholder}
                                onChange={(e) => set(field.key, e.target.value)}
                                disabled={disabled}
                            />
                        ) : (
                            <input
                                id={`${idPrefix}-${field.key}`}
                                className={`${inputClass} mt-1 text-xs`}
                                value={value[field.key] ?? ""}
                                placeholder={field.placeholder}
                                maxLength={field.key === "source" ? 1000 : 500}
                                onChange={(e) => set(field.key, e.target.value)}
                                disabled={disabled}
                            />
                        )}
                    </label>
                ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
                {line
                    ? `Uygulamada "Kaynak ve lisans" bölümünde: Kapak resmi: ${line}`
                    : "Boş bırakılırsa uygulamada kapak için künye gösterilmez. Bağlantılar düz metin olarak görünür."}
            </p>
        </div>
    );
}
