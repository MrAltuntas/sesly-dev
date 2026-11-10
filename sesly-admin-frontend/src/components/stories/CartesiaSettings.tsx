"use client";

import { Sliders, Volume2 } from "lucide-react";
import {
    SONIC3_EXTENDED_EMOTIONS,
    SONIC3_DEFAULT_EMOTION,
    SONIC3_DEFAULT_SPEED,
    SONIC3_SPEED_MAX,
    SONIC3_SPEED_MIN,
    SONIC3_SPEED_STEP,
    emotionLabel,
} from "@/lib/cartesia-emotions";

interface CartesiaSettingsProps {
    defaultEmotion: string;
    defaultSpeed: number | null;
    cartesiaPronunciationDictId: string;
    onChange: (changes: {
        defaultEmotion?: string;
        defaultSpeed?: number | null;
        cartesiaPronunciationDictId?: string;
    }) => void;
    disabled?: boolean;
}

export function CartesiaSettings({
    defaultEmotion,
    defaultSpeed,
    cartesiaPronunciationDictId,
    onChange,
    disabled = false,
}: CartesiaSettingsProps) {
    const speedValue = defaultSpeed ?? SONIC3_DEFAULT_SPEED;

    return (
        <div className="border border-border rounded-lg bg-muted/10 p-4 space-y-4">
            <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">Cartesia Sonic 3 Varsayılanları</h3>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">
                Bir segmentin kendi ayarı yoksa bu masal için kullanılacak değerler.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Default Emotion */}
                <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                        Varsayılan Duygu
                    </label>
                    <select
                        value={defaultEmotion || SONIC3_DEFAULT_EMOTION}
                        onChange={(e) => onChange({ defaultEmotion: e.target.value })}
                        disabled={disabled}
                        className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none disabled:opacity-50"
                    >
                        {SONIC3_EXTENDED_EMOTIONS.map((emotion) => (
                            <option key={emotion} value={emotion}>
                                {emotionLabel(emotion)}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Default Speed */}
                <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block flex items-center justify-between">
                        <span>Varsayılan Hız</span>
                        <span className="text-foreground font-mono">{speedValue.toFixed(2)}x</span>
                    </label>
                    <div className="flex items-center gap-2">
                        <Volume2 className="w-3.5 h-3.5 text-muted-foreground" />
                        <input
                            type="range"
                            min={SONIC3_SPEED_MIN}
                            max={SONIC3_SPEED_MAX}
                            step={SONIC3_SPEED_STEP}
                            value={speedValue}
                            onChange={(e) =>
                                onChange({ defaultSpeed: parseFloat(e.target.value) })
                            }
                            disabled={disabled}
                            className="flex-1 accent-primary disabled:opacity-50"
                        />
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground mt-1 font-mono">
                        <span>{SONIC3_SPEED_MIN.toFixed(2)}</span>
                        <span>1.00</span>
                        <span>{SONIC3_SPEED_MAX.toFixed(2)}</span>
                    </div>
                </div>
            </div>

            {/* Pronunciation Dict ID */}
            <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Cartesia Telaffuz Sözlüğü Kimliği (isteğe bağlı)
                </label>
                <input
                    type="text"
                    value={cartesiaPronunciationDictId}
                    onChange={(e) =>
                        onChange({ cartesiaPronunciationDictId: e.target.value })
                    }
                    placeholder="pron_dict_xxx"
                    disabled={disabled}
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-primary focus:outline-none disabled:opacity-50"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                    Cartesia panelinde oluşturulan sözlüğün kimliği. Boş bırakılırsa varsayılan
                    telaffuz kullanılır.
                </p>
            </div>
        </div>
    );
}
