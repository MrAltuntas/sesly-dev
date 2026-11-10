// Unit tests for the cover upload helpers. Run with `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
    baseName,
    coverCreditLine,
    coverKeyFromFileName,
    coverKeyVariants,
    findImportItemCover,
    importItemCoverKeys,
    isCoverImageName,
    isCreditFileName,
    normalizeCoverCredit,
    pairCoverFiles,
    parseCoverCreditText,
} from "./covers.ts";

const f = (name) => ({ name });

test("file names become the keys the backend matches (the batch images are <slug>.<ext>)", () => {
    assert.equal(coverKeyFromFileName("little-idas-flowers.jpg"), "little-idas-flowers");
    assert.equal(coverKeyFromFileName("images/little-idas-flowers.credit.json"), "little-idas-flowers");
    assert.equal(coverKeyFromFileName("Temiz Kedicik Tırmık.PNG"), "temiz-kedicik-tirmik");
    assert.equal(coverKeyFromFileName("Çirkin_Ördek  Yavrusu.webp"), "cirkin-ordek-yavrusu");
    assert.equal(coverKeyFromFileName("İnci--Kız!.jpeg"), "inci-kiz");
    assert.equal(coverKeyFromFileName("...."), "");
    assert.equal(baseName("a\\b\\c.png"), "c.png");
    assert.equal(isCoverImageName("x.JPG"), true);
    assert.equal(isCoverImageName("x.gif"), false);
    assert.equal(isCreditFileName("X.Credit.JSON"), true);
});

test("pictures are paired with their credit files; leftovers are reported", () => {
    const { pairs, unusedCredits, ignored } = pairCoverFiles([
        f("tattercoats.png"),
        f("tattercoats.credit.json"),
        f("colorful-birds.jpg"),
        f("colorful-birds.png"),
        f("orphan.credit.json"),
        f("orphan.credit.json"),
        f("credits.md"),
        f("!!!.jpg"),
    ]);
    assert.deepEqual(
        pairs.map((p) => [p.key, p.image.name, p.credit?.name ?? null]),
        [
            ["colorful-birds", "colorful-birds.jpg", null],
            ["tattercoats", "tattercoats.png", "tattercoats.credit.json"],
        ],
    );
    assert.deepEqual(unusedCredits.map((x) => x.name), ["orphan.credit.json"]);
    assert.deepEqual(
        ignored.map((i) => i.file.name),
        ["!!!.jpg", "colorful-birds.png", "credits.md", "orphan.credit.json"],
    );
});

test("a credit.json is read with its licence spelling; empty or bad files are explained", () => {
    const text = JSON.stringify({
        illustrator: " Greystroke ",
        illustratorDeathYear: null,
        source: "https://bloomlibrary.org/book/x",
        licence: "CC BY 4.0",
        licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
        attribution: "Illustration by Greystroke, CC BY 4.0.",
        width: 2300,
    });
    assert.deepEqual(parseCoverCreditText(text), {
        credit: {
            illustrator: "Greystroke",
            licenseName: "CC BY 4.0",
            licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
            source: "https://bloomlibrary.org/book/x",
            attribution: "Illustration by Greystroke, CC BY 4.0.",
        },
        error: null,
    });
    assert.match(parseCoverCreditText("{oops").error, /geçerli bir JSON/);
    assert.match(parseCoverCreditText("[1]").error, /nesne/);
    assert.match(parseCoverCreditText('{"width": 3}').error, /çizer, lisans/);
    assert.equal(normalizeCoverCredit(null), null);
    assert.deepEqual(normalizeCoverCredit({ licenseName: "CC0", licence: "x" }), { licenseName: "CC0" });
});

test("the public credit line: the attribution, else illustrator, licence with link and source", () => {
    assert.equal(coverCreditLine(null), "");
    assert.equal(coverCreditLine({ attribution: "A", illustrator: "B" }), "A");
    assert.equal(
        coverCreditLine({ illustrator: "Ada", licenseName: "CC BY 4.0", licenseUrl: "https://l", source: "S" }),
        "Ada, CC BY 4.0 (https://l), S",
    );
    assert.equal(coverCreditLine({ licenseUrl: "https://l" }), "https://l");
});

test("an import item finds its picture by pairKey, partOf, the pairKey without -p<N> or with an article", () => {
    assert.deepEqual(importItemCoverKeys({ pairKey: "cinderella-p1", partOf: "cinderella" }), ["cinderella-p1", "cinderella"]);
    assert.deepEqual(importItemCoverKeys({ pairKey: "Tattercoats" }), ["tattercoats"]);
    assert.deepEqual(importItemCoverKeys({}), []);
    assert.deepEqual(coverKeyVariants("the-fox"), ["the-fox", "fox"]);
    const { pairs } = pairCoverFiles([f("little-idas-flowers.jpg"), f("woodcutter-of-gura.jpg"), f("tattercoats.png")]);
    const name = (item) => findImportItemCover(item, pairs)?.image.name ?? null;
    assert.equal(name({ pairKey: "little-idas-flowers-p2", partOf: "little-idas-flowers" }), "little-idas-flowers.jpg");
    assert.equal(name({ pairKey: "the-woodcutter-of-gura" }), "woodcutter-of-gura.jpg");
    assert.equal(name({ pairKey: "tattercoats" }), "tattercoats.png");
    assert.equal(name({ pairKey: "someone-else" }), null);
});
