// Unit tests for the pure helpers of the stories page.
// Run with `npm test` (node --test, Node 22.18+ strips the TypeScript types).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
    EMPTY_STORY_FILTERS,
    activeStoryFilterCount,
    buildStoriesUrl,
    catalogueChanges,
    catalogueForCreate,
    catalogueFromStory,
    deleteConfirmMatches,
    emptyCatalogueForm,
    estimateDurationMinutes,
    fieldForApiError,
    getApiErrorData,
    isCatalogueDirty,
    missingPublishFields,
    CONTENT_WARNINGS,
    CONTENT_WARNING_LABELS,
    contentWarningOptions,
    describeContentWarnings,
    isContentWarning,
    parseContentWarnings,
    parseStoryFilters,
    toggleContentWarning,
    rebaseCatalogueForm,
    STORY_PAGE_SIZE,
    storyBrief,
    storyFiltersToApiParams,
    storyFiltersToIdParams,
    storyFiltersToQuery,
} from "./stories.ts";

const params = (query) => new URLSearchParams(query);

function story(overrides = {}) {
    return {
        id: "s-1",
        slug: "kirmizi-baslikli-kiz",
        status: "DRAFT",
        summary: null,
        originalTitle: null,
        originalLanguage: null,
        authorName: "Charles Perrault",
        authorDeathYear: 1703,
        collectorName: null,
        collectorDeathYear: null,
        translatorName: null,
        translatorDeathYear: null,
        adaptedBy: null,
        firstPublishedYear: null,
        editionYear: null,
        sourceName: null,
        sourceUrl: null,
        origin: "PUBLIC_DOMAIN",
        textFidelity: "RETOLD",
        sourceRetrievedAt: "2026-10-01T00:00:00.000Z",
        rightsBasis: null,
        rightsNote: null,
        licenseUrl: null,
        rightsVerifiedAt: null,
        rightsVerifiedBy: null,
        translationMethod: null,
        languageLevel: "A2",
        languageLevelNote: "Kısa cümleler. (Güven: %80)",
        ...overrides,
    };
}

test("an empty query parses to the empty filters", () => {
    assert.deepEqual(parseStoryFilters(params("")), EMPTY_STORY_FILTERS);
});

test("filters survive a round trip through the URL", () => {
    const filters = parseStoryFilters(
        params(
            "language=EN&status=draft&level=a1,B2,zz,A1&category=bedtime&missing=de&imported=yes&from=2026-09-01&to=2026-09-30&q=kedi&sort=level&page=3",
        ),
    );
    assert.deepEqual(filters, {
        language: "en",
        status: "DRAFT",
        levels: ["A1", "B2"],
        category: "BEDTIME",
        ageGroup: "",
        origin: "",
        missingLanguage: "de",
        imported: "yes",
        createdFrom: "2026-09-01",
        createdTo: "2026-09-30",
        q: "kedi",
        sort: "level",
        page: 3,
    });
    assert.deepEqual(parseStoryFilters(params(storyFiltersToQuery(filters))), filters);
});

test("imported and the created days: unknown values are dropped, API params are true/false and the days", () => {
    const bad = parseStoryFilters(params("imported=maybe&from=2026-13-01&to=27.09.2026"));
    assert.equal(bad.imported, "");
    assert.equal(bad.createdFrom, "");
    assert.equal(bad.createdTo, "");
    const api = storyFiltersToApiParams({ ...EMPTY_STORY_FILTERS, imported: "no", createdFrom: "2026-09-01", createdTo: "2026-09-27" });
    assert.equal(api.imported, "false");
    assert.equal(api.createdFrom, "2026-09-01");
    assert.equal(api.createdTo, "2026-09-27");
    assert.equal(storyFiltersToApiParams({ ...EMPTY_STORY_FILTERS, imported: "yes" }).imported, "true");
    // The day range counts as one filter.
    assert.equal(activeStoryFilterCount({ ...EMPTY_STORY_FILTERS, imported: "yes", createdFrom: "2026-09-01", createdTo: "2026-09-30" }), 2);
    assert.equal(activeStoryFilterCount({ ...EMPTY_STORY_FILTERS, createdTo: "2026-09-30" }), 1);
});

test("bulk delete confirmation: SİL in any case, dotted or dotless", () => {
    for (const word of ["SİL", "sil", " Sil ", "SIL"]) assert.equal(deleteConfirmMatches(word), true, word);
    for (const word of ["", "evet", "SILL", "delete"]) assert.equal(deleteConfirmMatches(word), false, word);
});

test("a bad page number falls back to the first page", () => {
    assert.equal(parseStoryFilters(params("page=abc")).page, 1);
    assert.equal(parseStoryFilters(params("page=-4")).page, 1);
});

test("defaults are left out of the URL and the open story is added", () => {
    assert.equal(buildStoriesUrl("/stories", EMPTY_STORY_FILTERS, null), "/stories");
    assert.equal(
        buildStoriesUrl("/stories", { ...EMPTY_STORY_FILTERS, language: "tr" }, "s-1"),
        "/stories?language=tr&story=s-1",
    );
});

test("api params join the levels and carry the page size", () => {
    const apiParams = storyFiltersToApiParams({ ...EMPTY_STORY_FILTERS, levels: ["A1", "A2"], page: 2 });
    assert.equal(apiParams.languageLevel, "A1,A2");
    assert.equal(apiParams.page, 2);
    assert.equal(typeof apiParams.limit, "number");
    assert.equal("language" in apiParams, false);
    assert.equal(apiParams.limit, STORY_PAGE_SIZE);
    assert.equal(STORY_PAGE_SIZE, 25);
    assert.equal(storyFiltersToApiParams(EMPTY_STORY_FILTERS, 200).limit, 200);
});

test("the id list takes the same filters, without page and size", () => {
    const filters = { ...EMPTY_STORY_FILTERS, language: "en", imported: "yes", sort: "title", page: 3 };
    assert.deepEqual(storyFiltersToIdParams(filters), {
        language: "en",
        imported: "true",
        sort: "title",
        view: "list",
    });
    assert.deepEqual(storyFiltersToIdParams(EMPTY_STORY_FILTERS), { view: "list" });
});

test("a list row becomes a brief for the bulk publish plan", () => {
    assert.deepEqual(storyBrief({ ...story(), title: "Kırmızı", reviewedAt: "2026-10-22T10:00:00.000Z" }, null), {
        id: "s-1",
        title: "Kırmızı",
        status: "DRAFT",
        reviewed: true,
        // Public domain without a rights basis and a source: the rule refuses it.
        publishable: false,
    });
    const ready = storyBrief(
        { ...story(), title: "T", reviewedAt: null, rightsBasis: "PUBLIC_DOMAIN_EXPIRED", sourceName: "Kaynak" },
        null,
    );
    assert.equal(ready.reviewed, false);
    assert.equal(ready.publishable, true);
});

test("sort and page are not counted as filters", () => {
    assert.equal(activeStoryFilterCount({ ...EMPTY_STORY_FILTERS, sort: "title", page: 4 }), 0);
    assert.equal(activeStoryFilterCount({ ...EMPTY_STORY_FILTERS, levels: ["A1", "A2"], q: "x" }), 2);
});

test("the form is built from the story, with dates cut to the day", () => {
    const form = catalogueFromStory(story());
    assert.equal(form.authorDeathYear, "1703");
    assert.equal(form.sourceRetrievedAt, "2026-10-01");
    assert.equal(form.summary, "");
    assert.equal(form.status, "DRAFT");
});

test("CC BY credit: attribution, licence name and link are edited and sent like the other fields", () => {
    const base = catalogueFromStory(
        story({ licenseName: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", attribution: null }),
    );
    assert.equal(base.licenseName, "CC BY 4.0");
    assert.equal(base.attribution, "");
    assert.equal(base.sourceEdition, "");
    const form = { ...base, attribution: " The Fox by A. Writer, CC BY 4.0 ", licenseName: "" };
    assert.deepEqual(catalogueChanges(form, base), {
        attribution: "The Fox by A. Writer, CC BY 4.0",
        licenseName: "",
    });
    assert.deepEqual(catalogueForCreate({ ...emptyCatalogueForm(), licenseName: "CC BY 4.0" }), {
        status: "DRAFT",
        licenseName: "CC BY 4.0",
    });
    const field = (message) => fieldForApiError({ message });
    assert.equal(field("Lisans en fazla 200 karakter olabilir."), "licenseName");
    assert.equal(field("Lisans bağlantısı http ya da https ile başlayan geçerli bir bağlantı olmalıdır."), "licenseUrl");
    assert.equal(field("Atıf metni en fazla 2000 karakter olabilir."), "attribution");
    assert.equal(field("Kaynak baskı en fazla 500 karakter olabilir."), "sourceEdition");
});

test("content warnings: the form holds the enum values in enum order and sends only a change", () => {
    const order = [...CONTENT_WARNINGS];
    const base = catalogueFromStory(story({ contentWarnings: ["SCARY", "SAD_ENDING"] }));
    assert.equal(base.contentWarnings, "SCARY,SAD_ENDING");
    assert.equal(catalogueFromStory(story()).contentWarnings, "");
    assert.deepEqual(parseContentWarnings(" DEATH, ,SCARY "), ["DEATH", "SCARY"]);

    const added = toggleContentWarning(base.contentWarnings, "DEATH", order);
    assert.equal(added, "SCARY,DEATH,SAD_ENDING");
    // Unticking it again is the stored value: nothing to send.
    const back = toggleContentWarning(added, "DEATH", order);
    assert.deepEqual(catalogueChanges({ ...base, contentWarnings: back }, base), {});
    // Clearing every warning sends "" (the backend stores none).
    const cleared = toggleContentWarning(toggleContentWarning(base.contentWarnings, "SCARY", order), "SAD_ENDING", order);
    assert.deepEqual(catalogueChanges({ ...base, contentWarnings: cleared }, base), { contentWarnings: "" });
    assert.equal(
        fieldForApiError({ message: "İçerik uyarısı şu değerlerden biri olmalıdır: SCARY, VIOLENCE." }),
        "contentWarnings",
    );
});

test("content warnings: the backend enum with its Turkish labels", () => {
    assert.deepEqual(CONTENT_WARNINGS, ["SCARY", "VIOLENCE", "DEATH", "SAD_ENDING", "BAD_EXAMPLE", "OLD_LANGUAGE", "LONELINESS"]);
    assert.deepEqual(CONTENT_WARNING_LABELS, {
        SCARY: "Korkutucu sahne",
        VIOLENCE: "Şiddet",
        DEATH: "Ölüm",
        SAD_ENDING: "Üzücü son",
        BAD_EXAMPLE: "Kötü davranış örneği",
        OLD_LANGUAGE: "Eski dil / ağır anlatım",
        LONELINESS: "Yalnızlık / ayrılık",
    });
    assert.equal(isContentWarning("SAD_ENDING"), true);
    assert.equal(isContentWarning("uzucu-son"), false);
    // The editor falls back to the local enum while the meta loads.
    assert.deepEqual(contentWarningOptions([]).map((o) => o.value), [...CONTENT_WARNINGS]);
    assert.equal(contentWarningOptions(undefined)[0].label, "Korkutucu sahne");
    const meta = [{ value: "SCARY", label: "Korkutucu sahne" }];
    assert.equal(contentWarningOptions(meta), meta);
});

test("content warnings: the import preview shows labels and flags values the backend refuses", () => {
    assert.deepEqual(describeContentWarnings(["LONELINESS", "scary", "SCARY"]), {
        labels: ["Korkutucu sahne", "Yalnızlık / ayrılık"],
        unknown: [],
    });
    assert.deepEqual(describeContentWarnings(["korkutucu", "DEATH", "zombi", "korkutucu"]), {
        labels: ["Ölüm"],
        unknown: ["korkutucu", "zombi"],
    });
    assert.deepEqual(describeContentWarnings(undefined), { labels: [], unknown: [] });
    assert.deepEqual(describeContentWarnings(["", 7]), { labels: [], unknown: ["7"] });
});

test("an untouched form sends nothing on PATCH", () => {
    const base = catalogueFromStory(story());
    assert.deepEqual(catalogueChanges({ ...base }, base), {});
    assert.equal(isCatalogueDirty({ ...base }, base), false);
});

test("PATCH carries only the changed fields; an emptied one clears", () => {
    const base = catalogueFromStory(story());
    const form = { ...base, status: "PUBLISHED", authorName: "  ", sourceName: " Gutenberg " };
    assert.deepEqual(catalogueChanges(form, base), {
        status: "PUBLISHED",
        authorName: "",
        sourceName: "Gutenberg",
    });
    assert.equal(isCatalogueDirty(form, base), true);
});

test("the level is not re-sent unless it changed, so an AI level stays AI", () => {
    const base = catalogueFromStory(story());
    const form = { ...base, summary: "Yeni özet" };
    assert.equal("languageLevel" in catalogueChanges(form, base), false);
});

test("an emptied slug is not sent on PATCH", () => {
    const base = catalogueFromStory(story());
    assert.deepEqual(catalogueChanges({ ...base, slug: "" }, base), {});
});

test("POST carries every filled field", () => {
    const form = { ...emptyCatalogueForm(), origin: "AI_GENERATED", summary: " Kısa " };
    assert.deepEqual(catalogueForCreate(form), { status: "DRAFT", origin: "AI_GENERATED", summary: "Kısa" });
});

test("rebasing follows the server for untouched inputs and keeps edits", () => {
    const oldBase = catalogueFromStory(story());
    const newBase = catalogueFromStory(story({ languageLevel: "B1", languageLevelNote: "Yeni not" }));
    const form = { ...oldBase, summary: "Düzenlenen özet" };
    const next = rebaseCatalogueForm(form, oldBase, newBase);
    assert.equal(next.languageLevel, "B1");
    assert.equal(next.languageLevelNote, "Yeni not");
    assert.equal(next.summary, "Düzenlenen özet");
    assert.deepEqual(catalogueChanges(next, newBase), { summary: "Düzenlenen özet" });
});

test("publish rule: origin and fidelity always", () => {
    assert.deepEqual(missingPublishFields(emptyCatalogueForm(), null), ["origin", "textFidelity"]);
});

test("publish rule: a public domain text needs rights, a source and a credit", () => {
    const form = { ...emptyCatalogueForm(), origin: "PUBLIC_DOMAIN", textFidelity: "VERBATIM" };
    assert.deepEqual(missingPublishFields(form, null), ["rightsBasis", "source", "attribution"]);
    const done = { ...form, rightsBasis: "CC0", sourceUrl: "https://example.org", collectorName: "Grimm" };
    assert.deepEqual(missingPublishFields(done, null), []);
});

test("publish rule: a CC BY text needs its attribution and licence name, whatever the origin", () => {
    const form = {
        ...emptyCatalogueForm(),
        origin: "LICENSED",
        textFidelity: "VERBATIM",
        rightsBasis: "CC_BY",
        sourceUrl: "https://example.org",
        authorName: "Yazar",
    };
    assert.deepEqual(missingPublishFields(form, null), ["ccAttribution", "ccLicense"]);
    assert.deepEqual(missingPublishFields({ ...form, attribution: "Book Dash", licenseName: "CC BY 4.0" }, null), []);
    const own = { ...emptyCatalogueForm(), origin: "AI_GENERATED", textFidelity: "RETOLD", rightsBasis: "CC_BY", licenseName: "CC BY 4.0" };
    assert.deepEqual(missingPublishFields(own, null), ["ccAttribution"]);
});

test("publish rule: a folk tale needs no name, an own text needs no rights", () => {
    const folk = {
        ...emptyCatalogueForm(),
        origin: "FOLK_ANONYMOUS",
        textFidelity: "RETOLD",
        rightsBasis: "FOLK_NO_AUTHOR",
        sourceName: "Derleme",
    };
    assert.deepEqual(missingPublishFields(folk, null), []);
    const own = { ...emptyCatalogueForm(), origin: "AI_GENERATED", textFidelity: "RETOLD" };
    assert.deepEqual(missingPublishFields(own, null), []);
});

test("publish rule follows the origins the meta endpoint lists", () => {
    const form = { ...emptyCatalogueForm(), origin: "ORIGINAL_HUMAN", textFidelity: "RETOLD" };
    const rules = { always: ["origin", "textFidelity"], rightsRequiredOrigins: ["ORIGINAL_HUMAN"] };
    assert.deepEqual(missingPublishFields(form, rules), ["rightsBasis", "source", "attribution"]);
});

test("the extras of a coded error are read from the response body", () => {
    const data = getApiErrorData({
        response: {
            status: 400,
            data: {
                statusCode: 400,
                message: "Masal yayınlanamaz. Eksik alanlar: Köken.",
                code: "STORY_PUBLISH_REQUIREMENTS",
                missing: ["origin", 4],
            },
        },
    });
    assert.equal(data.code, "STORY_PUBLISH_REQUIREMENTS");
    assert.deepEqual(data.missing, ["origin"]);
    assert.deepEqual(getApiErrorData(new Error("network")), {});
});

test("a validation message is attached to the field it names", () => {
    const field = (message, code) => fieldForApiError({ message, code });
    assert.equal(field("Yazarın ölüm yılı tam sayı olmalıdır."), "authorDeathYear");
    assert.equal(field("Yazar en fazla 200 karakter olabilir."), "authorName");
    assert.equal(field("Kaynak bağlantısı http ya da https ile başlayan geçerli bir bağlantı olmalıdır."), "sourceUrl");
    assert.equal(field("Kaynak adı en fazla 300 karakter olabilir."), "sourceName");
    assert.equal(field("Dil seviyesi notu en fazla 2000 karakter olabilir."), "languageLevelNote");
    assert.equal(field("Kısa ad yalnızca küçük harf, rakam ve tire içerebilir (ör. kirmizi-baslikli-kiz)."), "slug");
    assert.equal(field("x", "STORY_SLUG_TAKEN"), "slug");
    assert.equal(field("x", "TRANSLATION_LANGUAGE_TAKEN"), "language");
    assert.equal(field("Story not found"), null);
});

test("duration preview uses the backend formula: whole minutes, at least one, per-language pace", () => {
    const words = (n) => Array.from({ length: n }, (_, i) => `k${i}`).join(" ");
    assert.equal(estimateDurationMinutes("", 150), 1);
    assert.equal(estimateDurationMinutes(words(150), 150), 1);
    assert.equal(estimateDurationMinutes(words(151), 150), 2);
    // 300 words: 2 minutes in Turkish (150 wpm), 3 in German (140 wpm).
    assert.equal(estimateDurationMinutes(words(300), 150), 2);
    assert.equal(estimateDurationMinutes(words(300), 140), 3);
    // Unknown language: the backend default pace.
    assert.equal(estimateDurationMinutes(words(300)), 2);
    assert.equal(estimateDurationMinutes(words(300), 0), 2);
    assert.equal(estimateDurationMinutes("  bir\n\niki   uc  ", 150), 1);
});
