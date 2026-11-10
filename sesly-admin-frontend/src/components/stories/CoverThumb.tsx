"use client";

import { DragEvent, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import type { SetCoverResponse } from "@/types/api.types";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { COVER_IMAGE_ACCEPT, COVER_MAX_BYTES, isCoverImageName } from "@/lib/covers";
import { CoverUploadDialog } from "./CoverUploadDialog";

interface Props {
    storyId: string;
    title: string;
    /** The story's own cover. */
    coverUrl?: string | null;
    /** A cover the story borrows from another language or part (shown dimmed). */
    fallbackUrl?: string | null;
    canEdit: boolean;
    size?: "sm" | "md";
    onUploaded?: (result: SetCoverResponse) => void;
}

/**
 * Cover thumbnail of the story list and the review view: click it or drop a
 * picture on it to upload a new cover (a dialog confirms, with "Bu kapağı
 * tüm dillere ve bölümlere uygula" on by default and the picture credit).
 */
export function CoverThumb({ storyId, title, coverUrl, fallbackUrl, canEdit, size = "sm", onUploaded }: Props) {
    const toast = useToast();
    const inputRef = useRef<HTMLInputElement>(null);
    const [file, setFile] = useState<File | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const shown = coverUrl || fallbackUrl || "";
    const box = size === "sm" ? "w-10 h-10" : "w-28 h-28";

    const pick = (candidate: File | undefined | null) => {
        if (!candidate) return;
        if (!isCoverImageName(candidate.name)) {
            toast.error("Kapak JPEG, PNG ya da WebP olmalı.");
            return;
        }
        if (candidate.size > COVER_MAX_BYTES) {
            toast.error("Kapak en fazla 10 MB olabilir.");
            return;
        }
        setFile(candidate);
    };

    const onDrop = (e: DragEvent<HTMLButtonElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        if (!canEdit) return;
        pick(e.dataTransfer.files?.[0]);
    };

    const label = coverUrl
        ? "Kapağı değiştir: tıkla ya da resmi sürükle"
        : fallbackUrl
          ? "Bu masal başka bir dilin ya da bölümün kapağını kullanıyor. Kendi kapağını yüklemek için tıkla ya da sürükle."
          : "Kapak yok: tıkla ya da resmi sürükle";

    return (
        <>
            <button
                type="button"
                title={canEdit ? label : undefined}
                aria-label={canEdit ? `${title}: ${label}` : `${title} kapağı`}
                disabled={!canEdit}
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => {
                    if (!canEdit) return;
                    e.preventDefault();
                    setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                className={cn(
                    box,
                    "relative shrink-0 rounded-md border overflow-hidden flex items-center justify-center bg-muted/30 transition-colors",
                    canEdit ? "cursor-pointer hover:border-primary" : "cursor-default",
                    dragOver ? "border-primary ring-2 ring-primary" : shown ? "border-border" : "border-dashed border-border",
                )}
            >
                {shown ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={shown}
                        alt=""
                        className={cn("w-full h-full object-cover", !coverUrl && "opacity-50")}
                        loading="lazy"
                    />
                ) : (
                    <ImagePlus className={cn(size === "sm" ? "w-4 h-4" : "w-6 h-6", "text-muted-foreground")} aria-hidden />
                )}
            </button>
            <input
                ref={inputRef}
                type="file"
                accept={COVER_IMAGE_ACCEPT}
                className="hidden"
                onChange={(e) => {
                    pick(e.target.files?.[0]);
                    e.target.value = "";
                }}
            />
            {file && (
                <CoverUploadDialog
                    storyId={storyId}
                    storyTitle={title}
                    file={file}
                    onClose={() => setFile(null)}
                    onUploaded={(res) => {
                        setFile(null);
                        toast.success(
                            res.appliedTo > 1 ? `Kapak yüklendi, ${res.appliedTo} masala uygulandı.` : "Kapak yüklendi.",
                        );
                        onUploaded?.(res);
                    }}
                />
            )}
        </>
    );
}
