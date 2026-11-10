"use client";

import { useEffect, useState } from "react";
import { ImageUp, Loader2, Upload } from "lucide-react";
import { StoriesService } from "@/services/admin.service";
import type { CoverCredit, SetCoverResponse } from "@/types/api.types";
import { getErrorMessage } from "@/components/ui/error-state";
import { normalizeCoverCredit } from "@/lib/covers";
import { CoverCreditFields } from "./CoverCreditFields";
import { StoryModal } from "./StoryModal";

interface Props {
    storyId: string;
    storyTitle: string;
    file: File;
    /** Credit to start with (a matching .credit.json, or the current one). */
    initialCredit?: CoverCredit | null;
    onClose: () => void;
    onUploaded: (result: SetCoverResponse) => void;
}

/**
 * Confirmation of a quick cover upload (a picture clicked or dropped on a
 * thumbnail): preview, "Bu kapağı tüm dillere ve bölümlere uygula" (on by
 * default) and the optional credit of the picture.
 */
export function CoverUploadDialog({ storyId, storyTitle, file, initialCredit, onClose, onUploaded }: Props) {
    const [preview, setPreview] = useState<string>("");
    const [applyToTale, setApplyToTale] = useState(true);
    const [credit, setCredit] = useState<CoverCredit>(initialCredit ?? {});
    const [creditError, setCreditError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const url = URL.createObjectURL(file);
        setPreview(url);
        return () => URL.revokeObjectURL(url);
    }, [file]);

    const upload = async () => {
        setBusy(true);
        setError(null);
        try {
            const res = await StoriesService.setCover(storyId, file, {
                coverCredit: normalizeCoverCredit(credit),
                applyCoverToTale: applyToTale,
            });
            onUploaded(res.data);
        } catch (e) {
            setError(getErrorMessage(e, "Kapak yüklenemedi."));
        } finally {
            setBusy(false);
        }
    };

    return (
        <StoryModal
            title="Kapak yükle"
            subtitle={storyTitle}
            icon={<ImageUp className="w-5 h-5 text-primary" />}
            onClose={onClose}
            busy={busy}
        >
            <div className="flex gap-4 items-start">
                {preview && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview} alt="Yeni kapak önizleme" className="w-32 h-32 object-cover rounded-lg border border-border shrink-0" />
                )}
                <div className="space-y-2 text-xs">
                    <p className="text-muted-foreground break-all">{file.name}</p>
                    <label className="flex items-start gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            className="mt-0.5 accent-primary"
                            checked={applyToTale}
                            onChange={(e) => setApplyToTale(e.target.checked)}
                            disabled={busy}
                            data-testid="cover-dialog-apply-to-tale"
                        />
                        <span>
                            Bu kapağı tüm dillere ve bölümlere uygula
                            <span className="block text-muted-foreground">
                                Kapakta yazı olmadığı için aynı masalın bütün dilleri ve bölümleri bu kapağı kullanır.
                            </span>
                        </span>
                    </label>
                </div>
            </div>

            <CoverCreditFields
                idPrefix={`cover-credit-${storyId}`}
                value={credit}
                onChange={setCredit}
                onError={setCreditError}
                disabled={busy}
            />
            {creditError && <p className="text-xs text-amber-500">{creditError}</p>}
            {error && (
                <p role="alert" className="text-xs text-red-400">
                    {error}
                </p>
            )}
            <button
                type="button"
                onClick={upload}
                disabled={busy}
                className="w-full bg-primary hover:bg-primary/90 text-white py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {busy ? "Yükleniyor..." : "Kapağı yükle"}
            </button>
        </StoryModal>
    );
}
