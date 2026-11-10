"use client";

import { ReactNode, memo, useState } from "react";
import Link from "next/link";
import {
    AlertCircle,
    BadgeCheck,
    Bot,
    CheckCircle2,
    Circle,
    ExternalLink,
    Layers,
    Languages,
    Loader2,
    ScrollText,
    ShieldCheck,
} from "lucide-react";
import type { StoriesMeta, StoryReviewCard } from "@/types/api.types";
import { languageName, optionLabel } from "@/lib/stories";
import { emotionLine, textExcerpt } from "@/lib/review";
import { cn } from "@/lib/utils";
import { CoverThumb } from "./CoverThumb";
import { LanguageBadge, StatusBadge } from "./form-fields";

interface Props {
    card: StoryReviewCard;
    meta: StoriesMeta | null;
    selected: boolean;
    /** Stable callbacks (the card is memoised: 200 cards re-render only when their own props change). */
    onToggleSelect: (id: string) => void;
    onToggleReviewed: (card: StoryReviewCard) => Promise<void>;
    onCoverUploaded: () => void;
    canEdit: boolean;
    /** Stories on this page: a link to one of them jumps to its card, others open the editor. */
    pageIds: Set<string>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2 text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
        </div>
    );
}

/** Source name and edition, the edition alone when it already starts with the name. */
function sourceText(card: Pick<StoryReviewCard, "sourceName" | "sourceEdition">): string {
    const name = card.sourceName?.trim() ?? "";
    const edition = card.sourceEdition?.trim() ?? "";
    if (name && edition.startsWith(name)) return edition;
    return [name, edition].filter(Boolean).join(". ");
}

/** Characters of the text shown while a card is collapsed. */
const COLLAPSED_TEXT_CHARS = 240;

/**
 * One imported story in the review view: everything a reviewer checks before
 * publishing. The text starts collapsed and the card skips layout and paint
 * while off screen (content-visibility), so a page of 200 cards stays fluid.
 */
export const ReviewCard = memo(function ReviewCard({
    card,
    meta,
    selected,
    onToggleSelect,
    onToggleReviewed,
    onCoverUploaded,
    canEdit,
    pageIds,
}: Props) {
    const hrefOf = (id: string) => (pageIds.has(id) ? `#review-${id}` : `/stories?story=${id}`);
    const [fullText, setFullText] = useState(false);
    const [toggling, setToggling] = useState(false);
    const excerpt = fullText ? "" : textExcerpt(card.content, COLLAPSED_TEXT_CHARS);
    const truncated = fullText || excerpt.length < card.content.trim().length;

    const toggle = async () => {
        setToggling(true);
        try {
            await onToggleReviewed(card);
        } finally {
            setToggling(false);
        }
    };

    return (
        <article
            id={`review-${card.id}`}
            className={cn(
                "border rounded-xl bg-card p-4 space-y-3 min-w-0 scroll-mt-16 [content-visibility:auto] [contain-intrinsic-size:auto_420px]",
                card.reviewed ? "border-emerald-500/40" : "border-border",
                selected && "ring-2 ring-primary/50",
            )}
        >
            <header className="flex items-start gap-3">
                {canEdit && (
                    <input
                        type="checkbox"
                        aria-label={`${card.title} masalını seç`}
                        checked={selected}
                        onChange={() => onToggleSelect(card.id)}
                        className="w-4 h-4 mt-1 rounded border-border shrink-0"
                    />
                )}
                <CoverThumb
                    storyId={card.id}
                    title={card.title}
                    coverUrl={card.coverImageUrl}
                    fallbackUrl={card.sharedCoverImageUrl}
                    canEdit={canEdit}
                    size="md"
                    onUploaded={onCoverUploaded}
                />
                <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-base">{card.title}</h3>
                        <LanguageBadge code={card.language} title={languageName(meta, card.language)} />
                        <StatusBadge status={card.status} label={optionLabel(meta?.enums.status, card.status)} />
                        {card.isMachineTranslation && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-violet-500/40 bg-violet-500/10 text-violet-300 text-[10px] font-semibold">
                                <Bot className="w-3 h-3" aria-hidden /> Yapay zekâ çevirisi
                            </span>
                        )}
                        {card.partNumber && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border text-[10px]">
                                <Layers className="w-3 h-3" aria-hidden /> Bölüm {card.partNumber} / {card.parts.length}
                            </span>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                        <span className="px-1.5 py-0.5 rounded bg-muted">{card.categoryLabel}</span>
                        <span className="px-1.5 py-0.5 rounded bg-muted">{card.ageGroupLabel}</span>
                        {card.languageLevel && <span className="px-1.5 py-0.5 rounded bg-muted">{card.languageLevel}</span>}
                        <span className="px-1.5 py-0.5 rounded bg-muted">
                            {card.wordCount} kelime, {card.estimatedDuration} dk
                        </span>
                        {card.contentWarnings.map((w) => (
                            <span key={w.value} className="px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-500">
                                {w.label}
                            </span>
                        ))}
                        {card.contentWarnings.length === 0 && (
                            <span className="px-1.5 py-0.5 rounded border border-border text-muted-foreground">İçerik uyarısı yok</span>
                        )}
                    </div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                    <button
                        type="button"
                        onClick={toggle}
                        disabled={!canEdit || toggling}
                        aria-pressed={card.reviewed}
                        className={cn(
                            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors disabled:opacity-60",
                            card.reviewed
                                ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-400"
                                : "border-border hover:bg-muted",
                        )}
                    >
                        {toggling ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : card.reviewed ? (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : (
                            <Circle className="w-3.5 h-3.5" />
                        )}
                        İncelendi
                    </button>
                    <Link
                        href={`/stories?story=${card.id}`}
                        className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                    >
                        <ExternalLink className="w-3 h-3" /> Editörde aç
                    </Link>
                </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-1.5">
                <div className="space-y-1.5 min-w-0">
                    <Row label="Diğer dil">
                        {card.translations.length === 0 ? (
                            <span className="text-muted-foreground">Yok</span>
                        ) : (
                            card.translations.map((t) => (
                                <span key={t.id} className="mr-3 inline">
                                    <Languages className="w-3 h-3 mr-1 inline align-[-2px] text-muted-foreground" aria-hidden />
                                    <a href={hrefOf(t.id)} className="text-primary hover:underline">
                                        {t.title}
                                    </a>
                                    <span className="ml-1 uppercase text-muted-foreground">{t.language}</span>
                                    {t.reviewed && <BadgeCheck className="w-3 h-3 ml-1 inline align-[-2px] text-emerald-400" aria-label="İncelendi" />}
                                </span>
                            ))
                        )}
                    </Row>
                    {card.translatedFrom && (
                        <Row label="Çevrildiği metin">
                            {card.translatedFrom.title} ({card.translatedFrom.language.toUpperCase()})
                        </Row>
                    )}
                    {card.parts.length > 0 && (
                        <Row label="Bölümler">
                            {card.parts.map((p) => (
                                <span key={p.id} className="mr-2">
                                    {p.id === card.id ? (
                                        <span className="font-medium">Bölüm {p.number}</span>
                                    ) : (
                                        <a href={hrefOf(p.id)} className="text-primary hover:underline">
                                            Bölüm {p.number}
                                        </a>
                                    )}
                                </span>
                            ))}
                        </Row>
                    )}
                    <Row label="Yazar / derleyen">
                        {[card.authorName, card.collectorName].filter(Boolean).join(", ") || <span className="text-muted-foreground">Yok</span>}
                        {card.translatorName ? `. Çeviren: ${card.translatorName}` : ""}
                    </Row>
                    <Row label="Kaynak">
                        {sourceText(card) || card.sourceUrl || <span className="text-muted-foreground">Yok</span>}
                        {card.sourceUrl && sourceText(card) && (
                            <span className="block text-muted-foreground break-all">{card.sourceUrl}</span>
                        )}
                    </Row>
                    <Row label="Segment">
                        {card.segments.count > 0
                            ? `${card.segments.count} segment (${card.segments.source ?? "kaynak bilinmiyor"}, sürüm ${card.segments.version}): ${emotionLine(card)}`
                            : "Segment yok: ilk seslendirmede Gemini ile bölünür."}
                    </Row>
                </div>
                <div className="space-y-1.5 min-w-0">
                    <Row label="Köken / sadakat">
                        {optionLabel(meta?.enums.origin, card.origin) || "Yok"} /{" "}
                        {optionLabel(meta?.enums.textFidelity, card.textFidelity) || "Yok"}
                    </Row>
                    <Row label="Hak dayanağı">{optionLabel(meta?.enums.rightsBasis, card.rightsBasis) || "Yok"}</Row>
                    <Row label="Lisans">
                        {card.licenseName || <span className="text-muted-foreground">Yok</span>}
                        {card.licenseUrl && <span className="block text-muted-foreground break-all">{card.licenseUrl}</span>}
                    </Row>
                    <Row label="Atıf">{card.attribution || <span className="text-muted-foreground">Yok</span>}</Row>
                    <Row label="Kapak künyesi">
                        {card.coverCreditLine || (
                            <span className="text-muted-foreground">
                                {card.coverImageUrl ? "Künye yok" : card.sharedCoverImageUrl ? "Başka sürümün kapağı" : "Kapak yok"}
                            </span>
                        )}
                    </Row>
                    <Row label="Yayın kontrolü">
                        {card.publishable ? (
                            <span className="text-emerald-400 inline-flex items-center gap-1">
                                <ShieldCheck className="w-3.5 h-3.5" /> Yayınlanabilir
                            </span>
                        ) : (
                            <span className="text-red-400 inline-flex items-start gap-1">
                                <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" />
                                Eksik: {card.publishMissing.map((m) => m.label).join(", ")}
                            </span>
                        )}
                    </Row>
                </div>
            </div>

            <div className="border-t border-border pt-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                    <ScrollText className="w-3.5 h-3.5" /> Metin
                    {card.summary && <span className="ml-2 italic truncate">Özet: {card.summary}</span>}
                </div>
                <p className={cn("text-sm leading-relaxed font-serif", fullText ? "whitespace-pre-line" : "text-muted-foreground")}>
                    {fullText ? card.content : excerpt}
                </p>
                {truncated && (
                    <button
                        type="button"
                        onClick={() => setFullText((v) => !v)}
                        aria-expanded={fullText}
                        className="mt-1 text-xs text-primary hover:underline"
                    >
                        {fullText ? "Metni daralt" : `Metnin tamamını göster (${card.wordCount} kelime)`}
                    </button>
                )}
            </div>
            {card.reviewed && card.reviewedBy && (
                <p className="text-[11px] text-muted-foreground">İnceleyen: {card.reviewedBy}</p>
            )}
        </article>
    );
});
