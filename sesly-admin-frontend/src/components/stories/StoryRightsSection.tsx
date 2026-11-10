"use client";

import { Lock, ScrollText, Smartphone } from "lucide-react";
import type { StoriesMeta } from "@/types/api.types";
import type { CatalogueForm, CatalogueKey } from "@/lib/stories";
import { SelectField, TextAreaField, TextField } from "./form-fields";

interface Props {
    meta: StoriesMeta | null;
    form: CatalogueForm;
    onChange: (key: CatalogueKey, value: string) => void;
    /** API messages keyed by the input they belong to. */
    errors: Partial<Record<string, string>>;
    /** Inputs that still block publishing. */
    missing: Set<CatalogueKey>;
    disabled?: boolean;
}

/**
 * "Kaynak ve telif": where the text comes from and on what ground we publish
 * it. Two blocks on purpose: the credit is shown to users in the app, the
 * rights audit is our own record and never leaves the admin API.
 */
export function StoryRightsSection({ meta, form, onChange, errors, missing, disabled }: Props) {
    const enums = meta?.enums;

    const text = (key: CatalogueKey, label: string, extra: { hint?: string; maxLength?: number; placeholder?: string } = {}) => (
        <TextField
            id={`story-${key}`}
            label={label}
            value={form[key]}
            onChange={(value) => onChange(key, value)}
            error={errors[key]}
            missing={missing.has(key)}
            disabled={disabled}
            {...extra}
        />
    );

    const year = (key: CatalogueKey, label: string) => (
        <TextField
            id={`story-${key}`}
            label={label}
            value={form[key]}
            onChange={(value) => onChange(key, value)}
            error={errors[key]}
            disabled={disabled}
            inputMode="numeric"
            placeholder="ör. 1875"
            maxLength={5}
        />
    );

    return (
        <section className="border border-border rounded-lg bg-muted/10 p-4 space-y-4">
            <div>
                <div className="flex items-center gap-2">
                    <ScrollText className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-semibold">Kaynak ve telif</h3>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                    Metnin nereden geldiği ve hangi hakla yayınlandığı. Yayınlamak için köken ve metin sadakati her
                    zaman, bize ait olmayan metinlerde ayrıca hak dayanağı, kaynak ve yazar ya da derleyen gerekir.
                </p>
            </div>

            {/* Public credit */}
            <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                    <Smartphone className="w-3.5 h-3.5 text-green-400" />
                    Künye
                    <span className="font-normal text-muted-foreground">Uygulamada kullanıcıya gösterilir.</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <SelectField
                        id="story-origin"
                        label="Köken"
                        value={form.origin}
                        onChange={(value) => onChange("origin", value)}
                        options={enums?.origin ?? []}
                        emptyLabel="Belirtilmedi"
                        error={errors.origin}
                        missing={missing.has("origin")}
                        disabled={disabled}
                    />
                    <SelectField
                        id="story-textFidelity"
                        label="Metin sadakati"
                        value={form.textFidelity}
                        onChange={(value) => onChange("textFidelity", value)}
                        options={enums?.textFidelity ?? []}
                        emptyLabel="Belirtilmedi"
                        error={errors.textFidelity}
                        missing={missing.has("textFidelity")}
                        disabled={disabled}
                    />
                    {text("originalTitle", "Özgün başlık", { maxLength: 300 })}
                    {text("originalLanguage", "Özgün dil", {
                        hint: "İki ya da üç harfli dil kodu (ör. da, fa).",
                        maxLength: 3,
                    })}
                    {text("authorName", "Yazar", { maxLength: 200 })}
                    {year("authorDeathYear", "Yazarın ölüm yılı")}
                    {text("collectorName", "Derleyen", { maxLength: 200 })}
                    {year("collectorDeathYear", "Derleyenin ölüm yılı")}
                    {text("translatorName", "Çevirmen", { maxLength: 200 })}
                    {year("translatorDeathYear", "Çevirmenin ölüm yılı")}
                    {text("adaptedBy", "Uyarlayan", { maxLength: 200 })}
                    <SelectField
                        id="story-translationMethod"
                        label="Çeviri yöntemi"
                        value={form.translationMethod}
                        onChange={(value) => onChange("translationMethod", value)}
                        options={enums?.translationMethod ?? []}
                        emptyLabel="Çeviri değil"
                        error={errors.translationMethod}
                        disabled={disabled}
                    />
                    {year("firstPublishedYear", "İlk yayım yılı")}
                    {year("editionYear", "Baskı yılı")}
                    {text("sourceName", "Kaynak adı", { maxLength: 300, placeholder: "ör. Project Gutenberg" })}
                    <TextField
                        id="story-sourceUrl"
                        label="Kaynak bağlantısı"
                        type="url"
                        inputMode="url"
                        value={form.sourceUrl}
                        onChange={(value) => onChange("sourceUrl", value)}
                        error={errors.sourceUrl}
                        missing={missing.has("sourceUrl")}
                        disabled={disabled}
                        placeholder="https://"
                        maxLength={2000}
                    />
                    {text("licenseName", "Lisans", {
                        maxLength: 200,
                        placeholder: "ör. CC BY 4.0",
                        hint: "Uygulamada lisans bağlantısıyla birlikte gösterilir.",
                    })}
                    <TextField
                        id="story-licenseUrl"
                        label="Lisans bağlantısı"
                        type="url"
                        inputMode="url"
                        value={form.licenseUrl}
                        onChange={(value) => onChange("licenseUrl", value)}
                        error={errors.licenseUrl}
                        disabled={disabled}
                        placeholder="https://creativecommons.org/licenses/by/4.0/"
                        maxLength={2000}
                    />
                    <TextAreaField
                        id="story-attribution"
                        label="Atıf metni"
                        value={form.attribution}
                        onChange={(value) => onChange("attribution", value)}
                        error={errors.attribution}
                        disabled={disabled}
                        maxLength={2000}
                        rows={2}
                        className="md:col-span-2"
                    />
                    <p className="text-[11px] text-muted-foreground md:col-span-2 -mt-2">
                        CC BY metinlerde lisansın istediği atıf (eser, yazar, kaynak, lisans) buraya yazılır ve
                        uygulamada masalın künyesinde aynen gösterilir.
                    </p>
                </div>
            </div>

            {/* Internal rights audit */}
            <div className="border border-dashed border-amber-500/40 bg-amber-500/5 rounded-lg p-3 space-y-3">
                <div className="flex items-start gap-2 text-xs">
                    <Lock className="w-3.5 h-3.5 text-amber-400 mt-px shrink-0" />
                    <div>
                        <span className="font-semibold text-amber-400">Telif denetimi (yalnızca iç kullanım)</span>
                        <p className="text-muted-foreground mt-0.5">
                            Bu alanlar mobil uygulamaya hiç gönderilmez. Bir hak sorusu geldiğinde dayanağımızı
                            gösteren kayıttır.
                        </p>
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <SelectField
                        id="story-rightsBasis"
                        label="Hak dayanağı"
                        value={form.rightsBasis}
                        onChange={(value) => onChange("rightsBasis", value)}
                        options={enums?.rightsBasis ?? []}
                        emptyLabel="Belirtilmedi"
                        error={errors.rightsBasis}
                        missing={missing.has("rightsBasis")}
                        disabled={disabled}
                    />
                    {text("sourceEdition", "Kaynak baskı", {
                        maxLength: 500,
                        placeholder: "ör. Project Gutenberg eBook #5314",
                    })}
                    <TextField
                        id="story-sourceRetrievedAt"
                        label="Kaynağın alındığı tarih"
                        type="date"
                        value={form.sourceRetrievedAt}
                        onChange={(value) => onChange("sourceRetrievedAt", value)}
                        error={errors.sourceRetrievedAt}
                        disabled={disabled}
                    />
                    <TextField
                        id="story-rightsVerifiedAt"
                        label="Hakların doğrulandığı tarih"
                        type="date"
                        value={form.rightsVerifiedAt}
                        onChange={(value) => onChange("rightsVerifiedAt", value)}
                        error={errors.rightsVerifiedAt}
                        disabled={disabled}
                    />
                    {text("rightsVerifiedBy", "Hakları doğrulayan", {
                        maxLength: 200,
                        hint: "Tarih girilip boş bırakılırsa senin e-posta adresin yazılır.",
                    })}
                    <TextAreaField
                        id="story-rightsNote"
                        label="Hak notu"
                        value={form.rightsNote}
                        onChange={(value) => onChange("rightsNote", value)}
                        error={errors.rightsNote}
                        disabled={disabled}
                        maxLength={4000}
                        rows={3}
                        className="md:col-span-2"
                    />
                </div>
            </div>
        </section>
    );
}
