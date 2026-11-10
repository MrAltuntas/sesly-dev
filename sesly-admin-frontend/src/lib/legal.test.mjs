// Unit tests for the per-language legal document helpers.
// Run with `npm test` (node --test, Node 22.18+ strips the TypeScript types).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
    defaultLegalTitle,
    findLegalDoc,
    hasUnpublishedChanges,
    legalContentIssues,
    legalDocKey,
    legalDocState,
    legalLanguageNotice,
    legalSlugs,
    legalStateBadge,
    legalTabTitle,
    servedText,
} from "./legal.ts";

function doc(overrides = {}) {
    return {
        id: "id-tos-tr",
        slug: "tos",
        language: "tr",
        title: "Kullanım Şartları",
        contentMd: "# Kullanım Şartları",
        currentVersion: 1,
        status: "PUBLISHED",
        publishedAt: "2026-10-01T09:00:00.000Z",
        publishedBy: "owner@example.com",
        createdAt: "2026-10-01T09:00:00.000Z",
        updatedAt: "2026-10-01T09:00:00.000Z",
        ...overrides,
    };
}

const trTos = doc();
const enTosDraft = doc({ id: "id-tos-en", language: "en", title: "Terms of Use", status: "DRAFT", currentVersion: 0, publishedAt: null });
const enTosLive = doc({ id: "id-tos-en", language: "en", title: "Terms of Use", currentVersion: 2 });
const trPrivacy = doc({ id: "id-privacy-tr", slug: "privacy", title: "Gizlilik Politikası", currentVersion: 4 });

test("rows of the same slug are told apart by language", () => {
    const docs = [trPrivacy, trTos, enTosDraft];
    assert.equal(findLegalDoc(docs, "tos", "en"), enTosDraft);
    assert.equal(findLegalDoc(docs, "tos", "tr"), trTos);
    assert.equal(findLegalDoc(docs, "privacy", "en"), null);
    assert.notEqual(legalDocKey("tos", "tr"), legalDocKey("tos", "en"));
    assert.deepEqual(legalSlugs(docs), ["privacy", "tos"]);
});

test("state and badge: published, draft, missing", () => {
    assert.equal(legalDocState(trTos), "published");
    assert.equal(legalDocState(enTosDraft), "draft");
    assert.equal(legalDocState(null), "missing");
    assert.equal(legalStateBadge(trPrivacy), "v4");
    assert.equal(legalStateBadge(enTosDraft), "taslak");
    assert.equal(legalStateBadge(null), "yok");
});

test("tab title prefers the Turkish title", () => {
    assert.equal(legalTabTitle([enTosLive, trTos], "tos"), "Kullanım Şartları");
    assert.equal(legalTabTitle([enTosLive], "tos"), "Terms of Use");
    assert.equal(legalTabTitle([], "tos"), "tos");
});

test("English falls back to the published Turkish text", () => {
    assert.deepEqual(servedText([trTos], "tos", "en"), { kind: "fallback", language: "tr", version: 1 });
    assert.deepEqual(servedText([trTos, enTosDraft], "tos", "en"), { kind: "fallback", language: "tr", version: 1 });
    assert.deepEqual(servedText([trTos, enTosLive], "tos", "en"), { kind: "own", version: 2 });
    assert.deepEqual(servedText([trTos], "tos", "tr"), { kind: "own", version: 1 });
});

test("a Turkish draft is never served, and Turkish has no fallback", () => {
    const trDraft = doc({ status: "DRAFT", currentVersion: 0, publishedAt: null });
    assert.deepEqual(servedText([trDraft], "tos", "tr"), { kind: "none" });
    assert.deepEqual(servedText([trDraft], "tos", "en"), { kind: "none" });
    assert.deepEqual(servedText([trDraft, enTosLive], "tos", "tr"), { kind: "none" });
});

test("notice says what the app shows meanwhile", () => {
    const missing = legalLanguageNotice([trTos], "tos", "en");
    assert.equal(missing.tone, "warn");
    assert.equal(missing.title, "İngilizce sürüm yok");
    assert.match(missing.body, /Türkçe metni \(v1\)/);

    const draft = legalLanguageNotice([trTos, enTosDraft], "tos", "en");
    assert.equal(draft.tone, "warn");
    assert.equal(draft.title, "İngilizce sürüm taslak, hiç yayınlanmadı");
    assert.match(draft.body, /Türkçe metni \(v1\)/);

    const live = legalLanguageNotice([trTos, enTosLive], "tos", "en");
    assert.equal(live.tone, "ok");
    assert.equal(live.title, "İngilizce sürüm yayında (v2)");

    const turkish = legalLanguageNotice([trTos, enTosDraft], "tos", "tr");
    assert.equal(turkish.tone, "ok");
    assert.match(turkish.body, /İngilizce sürüm yayında olmadığı için/);
    assert.doesNotMatch(legalLanguageNotice([trTos, enTosLive], "tos", "tr").body, /olmadığı için/);

    const trDraft = doc({ status: "DRAFT", currentVersion: 0 });
    assert.equal(legalLanguageNotice([trDraft], "tos", "tr").tone, "error");
    assert.match(legalLanguageNotice([trDraft], "tos", "tr").body, /hiçbir kullanıcıya/);
    assert.equal(legalLanguageNotice([trDraft, enTosLive], "tos", "tr").body, "Uygulama dili Türkçe olan kullanıcılar bu belgeyi göremez.");
    assert.match(legalLanguageNotice([trDraft], "tos", "en").body, /^Türkçe sürüm de yayında olmadığı için uygulama dili İngilizce/);
});

test("notice texts keep the UI text rules", () => {
    const trDraft = doc({ status: "DRAFT", currentVersion: 0 });
    const sets = [[trTos], [trTos, enTosDraft], [trTos, enTosLive], [trDraft], [trDraft, enTosLive]];
    for (const docs of sets) {
        for (const language of ["tr", "en"]) {
            const { title, body } = legalLanguageNotice(docs, "tos", language);
            assert.deepEqual(legalContentIssues(title, body), [], `${title} ${body}`);
        }
    }
});

test("unpublished changes compare the draft with the latest version", () => {
    const latest = { version: 1, title: trTos.title, contentMd: trTos.contentMd };
    assert.equal(hasUnpublishedChanges(trTos, latest), false);
    assert.equal(hasUnpublishedChanges({ ...trTos, contentMd: "yeni" }, latest), true);
    assert.equal(hasUnpublishedChanges({ ...trTos, title: "Yeni" }, latest), true);
    assert.equal(hasUnpublishedChanges(enTosDraft, undefined), null);
    assert.equal(hasUnpublishedChanges(trTos, undefined), null);
    assert.equal(hasUnpublishedChanges(trTos, { ...latest, version: 0 }), null);
});

test("content issues flag the retired address, Stripe and forbidden characters", () => {
    assert.deepEqual(legalContentIssues("Kullanım Şartları", "Bize info@sesly.io adresinden ulaşın..."), []);
    const issues = legalContentIssues(
        "Gizlilik \u2014 Politikası",
        "destek@sesly.app ve DESTEK@sesly.app. Ödemeler Stripe ile\u2026 \u2192 \u{1F600}",
    );
    assert.deepEqual(
        issues.map((i) => [i.id, i.count]),
        [["old-email", 2], ["stripe", 1], ["em-dash", 1], ["ellipsis", 1], ["arrow", 1], ["emoji", 1]],
    );
    assert.deepEqual(legalContentIssues("", "striped"), []);
});

test("English drafts get the seeder titles", () => {
    assert.equal(defaultLegalTitle("tos", "en"), "Terms of Use");
    assert.equal(defaultLegalTitle("privacy", "en"), "Privacy Policy");
    assert.equal(defaultLegalTitle("data-deletion", "en"), "Data Deletion");
    assert.equal(defaultLegalTitle("cookies", "en"), "");
    assert.equal(defaultLegalTitle("tos", "tr"), "");
});
