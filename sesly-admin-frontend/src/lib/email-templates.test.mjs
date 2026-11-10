// Unit tests for the email templates page helpers.
// Run with `npm test` (node --test, Node 22.18+ strips the TypeScript types).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
    changedEmailFields,
    emailFieldLength,
    emailSourceLabel,
    findEmailTemplate,
    looksLikeEmail,
    placeholdersIn,
    problemsFromError,
    sameEmailFields,
    unknownPlaceholders,
} from "./email-templates.ts";

function fields(overrides = {}) {
    return {
        subject: "Konu",
        preheader: "",
        heading: "Başlık",
        body: "Merhaba {{name}},\n\nMetin",
        buttonLabel: "Devam",
        note: "",
        footer: "",
        ...overrides,
    };
}

test("sameEmailFields ignores surrounding space and Windows newlines", () => {
    assert.equal(sameEmailFields(fields(), fields({ subject: "  Konu ", body: "Merhaba {{name}},\r\n\r\nMetin" })), true);
    assert.equal(sameEmailFields(fields(), fields({ heading: "Başka" })), false);
});

test("changedEmailFields lists only the edited fields, in field order", () => {
    assert.deepEqual(changedEmailFields(fields(), fields({ footer: "x", subject: "y" })), ["subject", "footer"]);
    assert.deepEqual(changedEmailFields(fields(), fields()), []);
});

test("emailFieldLength counts code points after trimming", () => {
    assert.equal(emailFieldLength("  şğü  "), 3);
    assert.equal(emailFieldLength(""), 0);
});

test("placeholdersIn and unknownPlaceholders", () => {
    assert.deepEqual(placeholdersIn("Hi {{name}} {{ email }} {{name}} {{link}}"), ["name", "email", "link"]);
    const spec = { key: "subject", label: "Konu", hint: "", maxLength: 150, multiline: false, formatted: false, placeholders: ["name"] };
    assert.deepEqual(unknownPlaceholders(spec, "Selam {{name}} {{link}} {{foo}}"), ["link", "foo"]);
});

test("findEmailTemplate and emailSourceLabel", () => {
    const list = [
        { kind: "welcome", language: "tr", source: "default" },
        { kind: "welcome", language: "en", source: "custom" },
    ];
    assert.equal(findEmailTemplate(list, "welcome", "en"), list[1]);
    assert.equal(findEmailTemplate(list, "password_reset", "tr"), undefined);
    assert.equal(emailSourceLabel(list[0]), "Varsayılan");
    assert.equal(emailSourceLabel(list[1]), "Panelden");
});

test("problemsFromError reads the 400 problems list only", () => {
    assert.deepEqual(
        problemsFromError({ response: { status: 400, data: { problems: ["Konu boş olamaz.", "", 3] } } }),
        ["Konu boş olamaz."],
    );
    assert.equal(problemsFromError({ response: { status: 503, data: { problems: ["x"] } } }), null);
    assert.equal(problemsFromError({ response: { status: 400, data: { message: "x" } } }), null);
    assert.equal(problemsFromError(new Error("network")), null);
});

test("looksLikeEmail", () => {
    assert.equal(looksLikeEmail(" ben@sesly.io "), true);
    assert.equal(looksLikeEmail("ben@sesly"), false);
    assert.equal(looksLikeEmail("ben sesly.io"), false);
});
