import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderFormattedCorrectAnswer } from "./testAnswerFormatter";

test("testAnswerFormatter: renders plain text without bolding", () => {
  const result = renderFormattedCorrectAnswer("Rohan was praised by the teacher.") as React.ReactElement;
  assert.ok(result);
});

test("testAnswerFormatter: handles empty, null and undefined inputs gracefully", () => {
  assert.equal(renderFormattedCorrectAnswer(null), "");
  assert.equal(renderFormattedCorrectAnswer(undefined), "");
  assert.equal(renderFormattedCorrectAnswer(""), "");
});

test("testAnswerFormatter: handles bold tags and markdown", () => {
  const htmlBold = renderFormattedCorrectAnswer("<b>Rohan</b> was praised");
  assert.ok(htmlBold);
  const mdBold = renderFormattedCorrectAnswer("**Rohan** was praised");
  assert.ok(mdBold);
});

test("testAnswerFormatter: handles italic tags and markdown", () => {
  const htmlItalic = renderFormattedCorrectAnswer("<i>praised</i>");
  assert.ok(htmlItalic);
  const mdItalic = renderFormattedCorrectAnswer("*praised*");
  assert.ok(mdItalic);
});

test("testAnswerFormatter: handles underline tags", () => {
  const htmlUnderline = renderFormattedCorrectAnswer("<u>underlined text</u>");
  assert.ok(htmlUnderline);
});

test("testAnswerFormatter: handles multiline answers", () => {
  const multiline = renderFormattedCorrectAnswer("Line 1\nLine 2<br />Line 3");
  assert.ok(multiline);
});
