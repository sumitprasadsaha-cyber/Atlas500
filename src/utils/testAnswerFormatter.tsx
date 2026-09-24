import React from "react";

/**
 * Parses and renders correct answer content preserving bold, italic, and underline
 * formatting uploaded or stored by admin, while keeping normal text normal (not bold).
 * Renders cleanly in green when wrapped by the parent container.
 */
export function renderFormattedCorrectAnswer(val: unknown): React.ReactNode {
  if (val === null || val === undefined) return "";
  let raw = Array.isArray(val) ? val.join(", ") : String(val);

  // Normalize block HTML tags to newlines
  raw = raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<p\b[^>]*>/gi, "")
    .replace(/<\/div>/gi, "\n")
    .replace(/<div\b[^>]*>/gi, "")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

  if (!raw) return "";

  return parseInlineFormatting(raw);
}

function parseInlineFormatting(text: string, keyPrefix = "fmt"): React.ReactNode {
  if (!text) return null;

  // Split lines to preserve intentional newlines cleanly
  const lines = text.split("\n");
  if (lines.length > 1) {
    return (
      <>
        {lines.map((line, lIdx) => (
          <React.Fragment key={`${keyPrefix}-line-${lIdx}`}>
            {parseLineInlineFormatting(line, `${keyPrefix}-l${lIdx}`)}
            {lIdx < lines.length - 1 && <br />}
          </React.Fragment>
        ))}
      </>
    );
  }

  return parseLineInlineFormatting(text, keyPrefix);
}

function parseLineInlineFormatting(text: string, keyPrefix = "fline"): React.ReactNode {
  if (!text) return null;

  // Regex tokens:
  // 1 & 2: HTML bold: <b|strong>...</b|strong>
  // 3 & 4: HTML italic: <i|em>...</i|em>
  // 5 & 6: HTML underline: <u|ins>...</u|ins>
  // 7: Markdown bold: **...**
  // 8: Markdown bold: __...__
  // 9: Markdown italic: *...*
  // 10: Markdown italic: _..._
  // 11: Other HTML tags to strip safely
  const tokenRegex = /(<(?:b|strong)\b[^>]*>([\s\S]*?)<\/(?:b|strong)>)|(<(?:i|em)\b[^>]*>([\s\S]*?)<\/(?:i|em)>)|(<(?:u|ins)\b[^>]*>([\s\S]*?)<\/(?:u|ins)>)|(?:\*\*([^*]+)\*\*)|(?:__([^_]+)__)|(?:\*([^*]+)\*)|(?:_([^_]+)_)|(<[^>]+>)/i;

  const elements: React.ReactNode[] = [];
  let remaining = text;
  let idx = 0;

  while (remaining) {
    const match = tokenRegex.exec(remaining);
    if (!match) {
      elements.push(remaining);
      break;
    }

    const matchIndex = match.index;
    if (matchIndex > 0) {
      elements.push(remaining.substring(0, matchIndex));
    }

    const [
      fullMatch,
      ,
      boldHtml,
      ,
      italicHtml,
      ,
      underlineHtml,
      mdBoldStar,
      mdBoldUnderscore,
      mdItalicStar,
      mdItalicUnderscore,
      otherTag,
    ] = match;

    if (boldHtml !== undefined) {
      elements.push(
        <strong key={`${keyPrefix}-b-${idx++}`} className="font-bold">
          {parseLineInlineFormatting(boldHtml, `${keyPrefix}-b-${idx}`)}
        </strong>
      );
    } else if (italicHtml !== undefined) {
      elements.push(
        <em key={`${keyPrefix}-i-${idx++}`} className="italic">
          {parseLineInlineFormatting(italicHtml, `${keyPrefix}-i-${idx}`)}
        </em>
      );
    } else if (underlineHtml !== undefined) {
      elements.push(
        <span key={`${keyPrefix}-u-${idx++}`} className="underline">
          {parseLineInlineFormatting(underlineHtml, `${keyPrefix}-u-${idx}`)}
        </span>
      );
    } else if (mdBoldStar !== undefined || mdBoldUnderscore !== undefined) {
      const boldContent = mdBoldStar ?? mdBoldUnderscore ?? "";
      elements.push(
        <strong key={`${keyPrefix}-mb-${idx++}`} className="font-bold">
          {parseLineInlineFormatting(boldContent, `${keyPrefix}-mb-${idx}`)}
        </strong>
      );
    } else if (mdItalicStar !== undefined || mdItalicUnderscore !== undefined) {
      const italicContent = mdItalicStar ?? mdItalicUnderscore ?? "";
      elements.push(
        <em key={`${keyPrefix}-mi-${idx++}`} className="italic">
          {parseLineInlineFormatting(italicContent, `${keyPrefix}-mi-${idx}`)}
        </em>
      );
    } else if (otherTag !== undefined) {
      // Stripped tag, do not render tag itself
    }

    remaining = remaining.substring(matchIndex + fullMatch.length);
  }

  return <>{elements}</>;
}
