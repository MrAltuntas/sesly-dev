"use client";

/**
 * Admin Voice Clone Test page, full-pipeline edition.
 *
 * Drop an audio file in, pick a Story from the dropdown, hit "Run". Backend
 * uploads the raw clip, preprocesses it, clones the voice via Cartesia,
 * then runs the FULL production narration pipeline against the chosen
 * story (segment fan-out, per-segment emotion/speed/volume, ffmpeg merge).
 * Returns:
 *
 *   1. raw          : exactly what we uploaded
 *   2. processed    : what Cartesia actually receives after our pipeline
 *   3. final audio  : the merged narration (what a real user would hear)
 *   4. segments table: per-segment text + emotion/speed/volume + status
 *
 * No user account, no permanent VoiceProfile. The temporary profile + the
 * Cartesia voice id are cleaned up server-side, and the Audio + segment rows
 * cascade-delete with that profile. Only the GCS files remain (presigned
 * URLs below stay playable until they expire).
 */

import { useEffect, useMemo, useState } from "react";
import { Mic2, UploadCloud, Loader2, AlertCircle, BookOpen } from "lucide-react";
import { OpsService, StoriesService, VoiceCloneTestResult } from "@/services/admin.service";
import { AdminStoryListItem } from "@/types/api.types";
import { useToast } from "@/hooks/useToast";
import { getErrorMessage } from "@/components/ui/error-state";

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB hard cap

const VoiceTestPage = () => {
  const toast = useToast();
  const [stories, setStories] = useState<AdminStoryListItem[]>([]);
  // Segment count of the picked story: the list rows carry no segments.
  const [segmentInfo, setSegmentInfo] = useState<{ id: string; count: number } | null>(null);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [storyId, setStoryId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [skipPreprocessing, setSkipPreprocessing] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<VoiceCloneTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        // Pull a generous first page; if you need more we can wire infinite
        // scroll, but for a sandbox dropdown 100 is plenty.
        const res = await StoriesService.getAll({ page: 1, limit: 100 });
        if (cancelled) return;
        setStories(res.data.data ?? []);
      } catch (err) {
        console.error("Failed to load stories", err);
        toast.error("Hikayeler yüklenemedi");
      } finally {
        if (!cancelled) setStoriesLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedStory = useMemo(
    () => stories.find((s) => s.id === storyId) ?? null,
    [stories, storyId],
  );

  useEffect(() => {
    if (!storyId) return;
    let cancelled = false;
    StoriesService.getById(storyId)
      .then((res) => {
        if (!cancelled) setSegmentInfo({ id: storyId, count: res.data.preprocessedSegments?.length ?? 0 });
      })
      .catch(() => {
        if (!cancelled) setSegmentInfo({ id: storyId, count: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [storyId]);
  const segmentCount = segmentInfo?.id === storyId ? segmentInfo.count : null;

  const handleFileChange = (next: File | null) => {
    setError(null);
    if (!next) {
      setFile(null);
      return;
    }
    if (next.size > MAX_FILE_BYTES) {
      setError(
        `Dosya çok büyük (${formatBytes(next.size)}). Üst sınır ${formatBytes(MAX_FILE_BYTES)}.`,
      );
      return;
    }
    setFile(next);
  };

  const runTest = async () => {
    if (!file) {
      setError("Önce bir ses dosyası seç.");
      return;
    }
    if (!storyId) {
      setError("Bir hikaye seç.");
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await OpsService.voiceCloneTest(file, storyId, {
        skipPreprocessing,
      });
      setResult(res.data);
      if (res.data.audioStatus === "READY") {
        toast.success("Test tamamlandı");
      } else {
        toast.info(`Test bitti ama anlatım ${res.data.audioStatus}`);
      }
    } catch (err) {
      const fallback =
        err instanceof Error && err.message ? err.message : "Test başarısız oldu";
      setError(getErrorMessage(err, fallback));
      toast.error("Test başarısız");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-2">
        <Mic2 className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Ses Klon Testi</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Ses örneği yükle (10 sn temiz Türkçe konuşma idealdir) ve test
        etmek istediğin hikayeyi seç. Backend sırasıyla ön işleme, Cartesia
        klonlama, segment bazlı emotion/speed/volume ile anlatım ve ffmpeg
        birleştirme adımlarının tamamını çalıştırır. Üretimde kullanıcının
        duyduğunun birebir aynısı geri döner.
      </p>

      <section className="space-y-4 rounded-lg border border-border bg-card p-5">
        {/* File picker */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Ses dosyası
          </label>
          <label
            htmlFor="voice-test-file"
            className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border px-4 py-6 cursor-pointer hover:bg-muted/40 transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              <UploadCloud className="w-5 h-5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                {file ? (
                  <>
                    <p className="text-sm font-medium truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(file.size)}, {file.type || "bilinmiyor"}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium">Yüklemek için tıkla</p>
                    <p className="text-xs text-muted-foreground">
                      m4a, wav veya mp3. En fazla {formatBytes(MAX_FILE_BYTES)}
                    </p>
                  </>
                )}
              </div>
            </div>
            <input
              id="voice-test-file"
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        {/* Story picker */}
        <div>
          <label className="block text-sm font-medium mb-2">Hikaye</label>
          <div className="relative">
            <BookOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <select
              value={storyId}
              onChange={(e) => setStoryId(e.target.value)}
              disabled={storiesLoading}
              className="w-full rounded-md border border-border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
            >
              <option value="">
                {storiesLoading ? "Yükleniyor..." : "Bir hikaye seç..."}
              </option>
              {stories.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                  {typeof s._count?.chunks === "number"
                    ? ` (${s._count.chunks} bölüm)`
                    : ""}
                </option>
              ))}
            </select>
          </div>
          {selectedStory && segmentCount === null ? (
            <p className="text-xs text-muted-foreground mt-1">Segment bilgisi yükleniyor...</p>
          ) : selectedStory && segmentCount ? (
            <p className="text-xs text-muted-foreground mt-1">
              Bu hikayenin {segmentCount}{" "}
              önişlenmiş segmenti var (segment bazlı emotion ve speed
              ayarları uygulanacak).
            </p>
          ) : selectedStory ? (
            <p className="text-xs text-muted-foreground mt-1">
              Önişlenmiş segment yok. Metin paragraf bazlı yedek bölme ile
              parçalanacak, sadece varsayılan ayarlar uygulanır.
            </p>
          ) : null}
        </div>

        {/* Debug toggle */}
        <label className="flex items-start gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={skipPreprocessing}
            onChange={(e) => setSkipPreprocessing(e.target.checked)}
            className="mt-0.5"
          />
          <div>
            <p className="text-sm font-medium">
              Önişlemeyi atla (debug)
            </p>
            <p className="text-xs text-muted-foreground">
              {"ffmpeg adımı atlanır, ham klip doğrudan Cartesia'ya gider. " +
                "\"could not be processed\" hatası alıyorsan bunu açıp dene: " +
                "ham klip geçerse sorun ön işlemede, ham klip de başarısız olursa giriş dosyası bozuktur."}
            </p>
          </div>
        </label>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="button"
          onClick={runTest}
          disabled={!file || !storyId || running}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Çalışıyor... (1-3 dk sürebilir)
            </>
          ) : (
            <>
              <Mic2 className="w-4 h-4" />
              Testi başlat
            </>
          )}
        </button>
      </section>

      {result && (
        <section className="mt-8 space-y-5">
          <h2 className="text-lg font-semibold">Sonuçlar</h2>
          <p className="text-xs text-muted-foreground">
            İş <span className="font-mono">{result.jobId}</span>, hikaye{" "}
            {result.storyTitle}, toplam{" "}
            {(result.durationMs.total / 1000).toFixed(1)} sn (preprocess{" "}
            {result.durationMs.preprocess}ms, klon{" "}
            {result.durationMs.cloneCreate}ms, anlatım{" "}
            {(result.durationMs.narration / 1000).toFixed(1)} sn)
          </p>

          <ResultRow
            title="1. Ham kayıt"
            description="Yüklenen klip, hiçbir işlem yapılmadan."
            url={result.rawUrl}
          />
          <ResultRow
            title="2. İşlenmiş kayıt"
            description="ffmpeg işleminden (highpass=60, silenceremove) sonraki hali. Cartesia'ya giden dosya bu."
            url={result.processedUrl}
          />

          {result.finalAudioUrl ? (
            <ResultRow
              title="3. Klonlanmış ses ile tam anlatım"
              description={`${result.segmentCount} segment + per-segment emotion/speed + ffmpeg merge. Üretimde kullanıcının duyduğu.`}
              url={result.finalAudioUrl}
              highlight
            />
          ) : (
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
              <p className="text-sm font-semibold text-yellow-200 mb-1">
                Anlatım hazır değil ({result.audioStatus})
              </p>
              <p className="text-xs text-yellow-200/80">
                Final merged URL henüz yok. Audio ID:{" "}
                <span className="font-mono">{result.audioId}</span>. Backend
                logunu kontrol et, bazı segmentler hata almış olabilir.
              </p>
            </div>
          )}

          {result.segments.length > 0 && (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">Metin</th>
                    <th className="px-3 py-2 font-medium">Emotion</th>
                    <th className="px-3 py-2 font-medium">Speed</th>
                    <th className="px-3 py-2 font-medium">Volume</th>
                    <th className="px-3 py-2 font-medium">Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {result.segments.map((seg) => (
                    <tr
                      key={seg.index}
                      className="border-t border-border align-top"
                    >
                      <td className="px-3 py-2 font-mono text-muted-foreground">
                        {seg.index}
                      </td>
                      <td className="px-3 py-2 max-w-md">
                        <span className="line-clamp-3">{seg.content}</span>
                      </td>
                      <td className="px-3 py-2">{seg.emotion ?? "-"}</td>
                      <td className="px-3 py-2">
                        {seg.speed != null ? seg.speed.toFixed(2) : "-"}
                      </td>
                      <td className="px-3 py-2">
                        {seg.volume != null ? seg.volume.toFixed(2) : "-"}
                      </td>
                      <td className="px-3 py-2">
                        <SegmentStatusBadge status={seg.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-muted-foreground pt-2">
            {"Bağlantılar 7 gün geçerli. Cartesia ses kimliği ve geçici VoiceProfile, anlatım biter bitmez silindi. " +
              "Bu profile bağlı Audio ve segment kayıtları da onunla birlikte silinir; yalnızca GCS'deki ses dosyaları kalır. " +
              "İstersen Storage sayfasından yetim dosya olarak temizleyebilirsin."}
          </p>
        </section>
      )}
    </div>
  );
};

interface ResultRowProps {
  title: string;
  description: string;
  url: string;
  highlight?: boolean;
}

const ResultRow: React.FC<ResultRowProps> = ({
  title,
  description,
  url,
  highlight,
}) => (
  <div
    className={`rounded-lg border p-4 ${
      highlight
        ? "border-primary/40 bg-primary/5"
        : "border-border bg-card"
    }`}
  >
    <div className="flex items-center justify-between gap-3 mb-1">
      <h3 className="text-sm font-semibold">{title}</h3>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="text-xs text-primary hover:underline"
      >
        İndir / yeni sekme
      </a>
    </div>
    <p className="text-xs text-muted-foreground mb-3">{description}</p>
    <audio src={url} controls preload="none" className="w-full" />
  </div>
);

const SegmentStatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const tone =
    status === "READY"
      ? "bg-green-500/15 text-green-300 border-green-500/30"
      : status === "FAILED"
      ? "bg-red-500/15 text-red-300 border-red-500/30"
      : status === "GENERATING" || status === "PENDING"
      ? "bg-yellow-500/15 text-yellow-300 border-yellow-500/30"
      : "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone}`}
    >
      {status}
    </span>
  );
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default VoiceTestPage;
