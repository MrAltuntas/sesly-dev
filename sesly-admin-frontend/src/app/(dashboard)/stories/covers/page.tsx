"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { BulkCoverUpload } from "@/components/stories/BulkCoverUpload";

export default function BulkCoversPage() {
    const { canReviewStories } = usePermissions();

    if (!canReviewStories) {
        return <div className="p-6 text-sm text-muted-foreground">Kapak yüklemek için masal düzenleme yetkisi gerekir.</div>;
    }

    return (
        <div className="space-y-4">
            <div>
                <Link href="/stories" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1">
                    <ArrowLeft className="w-3.5 h-3.5" /> İçerik Stüdyosu
                </Link>
                <h2 className="text-3xl font-bold tracking-tight">Toplu kapak yükle</h2>
                <p className="text-muted-foreground">
                    Çok sayıda resmi bir kerede yükle. Her dosya adıyla bir masala eşleştirilir; yüklemeden önce eşleşmeleri,
                    künyeleri ve mevcut kapakları görürsün.
                </p>
            </div>
            <BulkCoverUpload />
        </div>
    );
}
