// Unit tests for the draft handling of the runtime settings form.
// Run with `npm test` (node --test, Node 22.18+ strips the TypeScript types).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
    formatSettingValue,
    isDraftDirty,
    parseDraft,
    settingOptionLabel,
    toDraft,
    withDraft,
    withoutCleanDraft,
} from "./settings.ts";

function setting(overrides = {}) {
    return {
        key: "tts.cartesia.defaultVolume",
        group: "tts",
        type: "float",
        label: "Cartesia ses seviyesi",
        description: "",
        unit: null,
        constraints: { min: 0.5, max: 2, step: 0.05, options: null, pattern: null, maxLength: null },
        value: 1,
        source: "default",
        fallbackValue: 1,
        fallbackSource: "default",
        defaultValue: 1,
        envVar: "CARTESIA_DEFAULT_VOLUME",
        updatedAt: null,
        updatedByAdminId: null,
        ...overrides,
    };
}

/**
 * Replays what the form does per keystroke: store the draft, then render the
 * input with the stored draft or, when there is none, the server text.
 * Returns the text the controlled input shows after each keystroke.
 */
function typeInto(item, keys) {
    let drafts = {};
    let shown = toDraft(item, item.value);
    const frames = [];
    for (const key of keys) {
        drafts = withDraft(drafts, item, shown + key);
        shown = item.key in drafts ? drafts[item.key] : toDraft(item, item.value);
        frames.push(shown);
    }
    return { drafts, frames };
}

test("typing 1 to 1.05 keeps every intermediate character", () => {
    const item = setting();
    const { drafts, frames } = typeInto(item, [".", "0", "5"]);
    assert.deepEqual(frames, ["1.", "1.0", "1.05"]);
    assert.deepEqual(parseDraft(item, drafts[item.key]), { ok: true, value: 1.05 });
    assert.equal(isDraftDirty(item, drafts[item.key]), true);
});

test("the same holds for other X to X.0Y edits", () => {
    const rate = setting({ key: "tts.google.speakingRate", value: 1 });
    assert.deepEqual(typeInto(rate, [".", "0", "5"]).frames, ["1.", "1.0", "1.05"]);

    const temperature = setting({
        key: "llm.gemini.temperature",
        value: 0.2,
        constraints: { min: 0, max: 2, step: null, options: null, pattern: null, maxLength: null },
    });
    assert.deepEqual(typeInto(temperature, ["0", "5"]).frames, ["0.20", "0.205"]);
});

test("a draft equal to the server value is stored but is not a pending change", () => {
    const item = setting();
    const drafts = withDraft({}, item, "1.0");
    assert.equal(drafts[item.key], "1.0");
    assert.equal(isDraftDirty(item, drafts[item.key]), false);
});

test("withDraft does not mutate the previous map and keeps other keys", () => {
    const item = setting();
    const prev = { other: "x" };
    const next = withDraft(prev, item, "1.5");
    assert.deepEqual(prev, { other: "x" });
    assert.deepEqual(next, { other: "x", [item.key]: "1.5" });
});

test("blur drops a draft that changes nothing, so the canonical text returns", () => {
    const item = setting();
    const prev = { other: "x", [item.key]: "1.0" };
    const next = withoutCleanDraft(prev, item);
    assert.deepEqual(next, { other: "x" });
    assert.deepEqual(prev, { other: "x", [item.key]: "1.0" });
});

test("blur keeps a dirty draft and returns the same object", () => {
    const item = setting();
    const prev = { [item.key]: "1.05" };
    assert.equal(withoutCleanDraft(prev, item), prev);
});

test("blur keeps an unparsable draft so the admin still sees the error", () => {
    const item = setting();
    const empty = { [item.key]: "" };
    assert.equal(withoutCleanDraft(empty, item), empty);
    const outOfRange = { [item.key]: "15" };
    assert.equal(withoutCleanDraft(outOfRange, item), outOfRange);
});

test("blur without a draft returns the same object", () => {
    const item = setting();
    const prev = { other: "x" };
    assert.equal(withoutCleanDraft(prev, item), prev);
});

test("string settings keep a trailing space while typing and drop it on blur", () => {
    const item = setting({
        key: "llm.gemini.model",
        type: "string",
        value: "gemini-pro",
        constraints: { min: null, max: null, step: null, options: null, pattern: null, maxLength: 100 },
    });
    const typed = withDraft({}, item, "gemini-pro ");
    assert.equal(typed[item.key], "gemini-pro ");
    assert.equal(isDraftDirty(item, typed[item.key]), false);
    assert.deepEqual(withoutCleanDraft(typed, item), {});
});

test("boolean and list drafts equal to the server value are dropped as well", () => {
    const flag = setting({ key: "a.flag", type: "boolean", value: true });
    assert.deepEqual(withoutCleanDraft({ [flag.key]: true }, flag), {});
    const kept = { [flag.key]: false };
    assert.equal(withoutCleanDraft(kept, flag), kept);

    const list = setting({ key: "a.list", type: "stringList", value: ["en", "tr"] });
    assert.deepEqual(withoutCleanDraft({ [list.key]: ["en", "tr"] }, list), {});
});

test("options are shown by their Turkish name, the stored value stays raw", () => {
    const provider = setting({
        key: "tts.defaultProvider",
        type: "enum",
        value: "google",
        constraints: {
            min: null,
            max: null,
            step: null,
            options: ["google", "cartesia"],
            optionLabels: [
                { value: "google", label: "Google Cloud TTS" },
                { value: "cartesia", label: "Cartesia Sonic" },
            ],
            pattern: null,
            maxLength: null,
        },
    });
    assert.equal(settingOptionLabel(provider, "cartesia"), "Cartesia Sonic");
    assert.equal(formatSettingValue(provider, "google"), "Google Cloud TTS");
    // A value without a label (older backend, removed option) is shown as it is.
    assert.equal(settingOptionLabel(provider, "azure"), "azure");
    assert.deepEqual(parseDraft(provider, "cartesia"), { ok: true, value: "cartesia" });

    const languages = setting({
        key: "content.enabledLanguages",
        type: "stringList",
        value: ["tr", "en"],
        constraints: {
            min: null,
            max: null,
            step: null,
            options: ["tr", "en", "de"],
            optionLabels: [
                { value: "tr", label: "Türkçe" },
                { value: "en", label: "İngilizce (English)" },
            ],
            pattern: null,
            maxLength: null,
        },
    });
    assert.equal(formatSettingValue(languages, ["tr", "en", "de"]), "Türkçe, İngilizce (English), de");
    assert.equal(formatSettingValue(languages, []), "(boş)");
});

test("a backend that sends no optionLabels still renders the raw options", () => {
    const legacy = setting({
        type: "enum",
        value: "google",
        constraints: { min: null, max: null, step: null, options: ["google"], pattern: null, maxLength: null },
    });
    assert.equal(settingOptionLabel(legacy, "google"), "google");
    assert.equal(formatSettingValue(legacy, "google"), "google");
    // Numbers keep their unit.
    assert.equal(formatSettingValue(setting({ unit: "saniye" }), 60), "60 saniye");
});
