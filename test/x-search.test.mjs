import assert from "node:assert";
import { describe, it } from "node:test";

import { buildXSearchPrompt, extractXSearchHits } from "../src/grok.mjs";
import { runCli, fakeGrokEnv } from "./helpers.mjs";

describe("buildXSearchPrompt", () => {
  it("instructs Grok to use X search and return web-search-style hits", () => {
    const prompt = buildXSearchPrompt({
      query: "grok 4.6",
      mode: "Latest",
      limit: 10,
    });
    assert.match(prompt, /x_keyword_search/);
    assert.match(prompt, /XSearch/);
    assert.match(prompt, /NOT web_search/);
    assert.match(prompt, /- query: grok 4\.6/);
    assert.match(prompt, /- mode: Latest/);
    assert.match(prompt, /- limit: 10/);
    assert.match(prompt, /url/);
    assert.match(prompt, /handle/);
    assert.match(prompt, /snippet/);
    assert.doesNotMatch(prompt, /from:/);
  });

  it("adds from:handle when a handle is given", () => {
    const prompt = buildXSearchPrompt({
      query: "openai",
      from: "elonmusk",
      mode: "Latest",
      limit: 3,
    });
    assert.match(prompt, /from:elonmusk/);
    assert.match(prompt, /- query: openai/);
  });

  it("forbids preamble and requires a list-only hit format", () => {
    const prompt = buildXSearchPrompt({
      query: "grok 4.6",
      mode: "Latest",
      limit: 10,
    });
    assert.match(prompt, /Do not write any preamble/);
    assert.match(prompt, /do not mention tools, skills, or use-grok/i);
    assert.match(prompt, /url: <url>/);
    assert.match(prompt, /handle: @<handle>/);
    assert.match(prompt, /snippet: <text>/);
    assert.match(prompt, /date: <iso-or-unknown>/);
    assert.match(prompt, /X_SEARCH_UNAVAILABLE/);
  });
});

describe("extractXSearchHits", () => {
  it("keeps template-only grok output unchanged", () => {
    const raw =
      "Fake Grok says: For each post use exactly this shape:\n1. url: <url>\n   handle: @<handle>";
    assert.strictEqual(extractXSearchHits(raw), raw);
  });

  it("drops preamble before the first real hit", () => {
    const raw = [
      "I'll search X for recent posts.",
      "I'll run the skill's X-search command.",
      "1. url: https://x.com/elonmusk/status/1",
      "   handle: @elonmusk",
      "   snippet: Can’t trust OpenAI",
      "   date: 2026-08-04T14:46:28Z",
    ].join("\n");
    const extracted = extractXSearchHits(raw);
    assert.strictEqual(
      extracted,
      [
        "1. url: https://x.com/elonmusk/status/1",
        "   handle: @elonmusk",
        "   snippet: Can’t trust OpenAI",
        "   date: 2026-08-04T14:46:28Z",
      ].join("\n")
    );
    assert.doesNotMatch(extracted, /I'll search/);
  });

  it("finds a hit glued to preamble on the same line", () => {
    const raw =
      "I'll search X.1. url: https://x.com/elonmusk/status/1\n   handle: @elonmusk";
    const extracted = extractXSearchHits(raw);
    assert.ok(extracted.startsWith("1. url: https://x.com/elonmusk/status/1"));
    assert.doesNotMatch(extracted, /I'll search/);
  });

  it("returns X_SEARCH_UNAVAILABLE when there are no hits", () => {
    const raw = "I'll try X search.\nX_SEARCH_UNAVAILABLE";
    assert.strictEqual(extractXSearchHits(raw), "X_SEARCH_UNAVAILABLE");
  });
});

describe("x-search", () => {
  it("runs a foreground X search and wraps grok output as json", () => {
    const result = runCli(["x-search", "grok 4.6", "--json"], { env: fakeGrokEnv() });
    assert.strictEqual(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.status, 0);
    assert.match(parsed.output, /x_keyword_search/);
    assert.match(parsed.output, /grok 4\.6/);
    assert.match(parsed.output, /approve=always/);
    assert.match(parsed.output, /verbatim/);
  });

  it("passes from, mode, and limit into the grok prompt", () => {
    const result = runCli(
      ["x-search", "openai", "--from", "elonmusk", "--mode", "top", "--limit", "5", "--json"],
      { env: fakeGrokEnv() }
    );
    assert.strictEqual(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.match(parsed.output, /from:elonmusk/);
    assert.match(parsed.output, /mode: Top/);
    assert.match(parsed.output, /limit: 5/);
  });

  it("strips a leading @ from --from", () => {
    const result = runCli(["x-search", "openai", "--from", "@elonmusk", "--json"], {
      env: fakeGrokEnv(),
    });
    assert.strictEqual(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.match(parsed.output, /from:elonmusk/);
    assert.doesNotMatch(parsed.output, /from:@elonmusk/);
  });

  it("passes model and effort to grok", () => {
    const result = runCli(["x-search", "hello", "--model", "grok-4", "--effort", "high"], {
      env: fakeGrokEnv(),
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /model=grok-4/);
    assert.match(result.stdout, /effort=high/);
  });

  it("fails without a query", () => {
    const result = runCli(["x-search"], { env: fakeGrokEnv() });
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /prompt is required/i);
  });

  it("rejects an invalid mode", () => {
    const result = runCli(["x-search", "hello", "--mode", "best"], { env: fakeGrokEnv() });
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /Invalid mode/);
  });

  it("rejects a non-positive limit", () => {
    const result = runCli(["x-search", "hello", "--limit", "0"], { env: fakeGrokEnv() });
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /Invalid limit/);
  });
});
