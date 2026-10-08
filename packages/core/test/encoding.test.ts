// A failing vector means the code is wrong, never the vector. The expected
// values were computed outside this codebase, with Python's hashlib and json.
import { describe, expect, it } from "vitest";
import {
  creatorObjectName,
  decodeLinksValue,
  encodeLinksValue,
  fold,
  keyedCandidate,
  linksKey,
  type LinksValue,
  shardNumber,
  shardObjectName,
  targetUrlSha256,
} from "@url-shortener/core";

describe("fold", { tags: ["adr-0018"] }, () => {
  it.each([
    ["Ab3xYz9", "ab3xyz9"],
    ["launch-2026_Q4", "launch-2026_q4"],
    ["\u212Aey", "\u212Aey"],
    ["\u0130x", "\u0130x"],
    ["\u03A3A", "\u03A3a"],
    ["\u00C9t\u00C9", "\u00C9t\u00C9"],
  ])("folds only the ASCII letters A–Z: %j to %j", (shortCode, folded) => {
    expect(fold(shortCode)).toBe(folded);
  });
});

describe("shardNumber", { tags: ["adr-0008", "adr-0014", "adr-0018"] }, () => {
  it.each([
    ["default", "Ab3xYz9", 39],
    ["default", "Sale", 138],
    ["default", "launch-2026_q4", 26],
    ["default", "x_Y", 99],
    ["default", "00042QD", 0],
    ["default", "0001sW2", 7],
    ["default", "000Epx6", 255],
    ["ns_Q7f3kPz9Lm", "Ab3xYz9", 247],
  ])("places %s:%s on shard %i", async (namespace, shortCode, shard) => {
    expect(await shardNumber(namespace, shortCode)).toBe(shard);
  });

  it.each([
    ["Ab3xYz9", "ab3xyz9", 39],
    ["AB3XYZ9", "ab3xyz9", 39],
    ["Sale", "sale", 138],
  ])("places %s and its lowercase variant %s on the same shard, %i", async (mixed, lower, shard) => {
    expect(await shardNumber("default", mixed)).toBe(shard);
    expect(await shardNumber("default", lower)).toBe(shard);
  });
});

describe("object names", { tags: ["adr-0008"] }, () => {
  it.each([
    [0, "shard-0"],
    [7, "shard-7"],
    [138, "shard-138"],
    [255, "shard-255"],
  ])("names shard %i %s", (shard, name) => {
    expect(shardObjectName(shard)).toBe(name);
  });

  it("names a Creator's object by its Creator ID", () => {
    expect(creatorObjectName("cr_4fK9pQ2xZ7")).toBe("cr_4fK9pQ2xZ7");
  });
});

describe("linksKey", { tags: ["adr-0008", "adr-0014", "adr-0018"] }, () => {
  it.each([
    ["default", "Ab3xYz9", "27:default:Ab3xYz9"],
    ["default", "ab3xyz9", "27:default:ab3xyz9"],
    ["default", "Sale", "8a:default:Sale"],
    ["default", "launch-2026_q4", "1a:default:launch-2026_q4"],
    ["default", "00042QD", "00:default:00042QD"],
    ["default", "0001sW2", "07:default:0001sW2"],
    ["default", "000Epx6", "ff:default:000Epx6"],
    ["ns_Q7f3kPz9Lm", "Ab3xYz9", "f7:ns_Q7f3kPz9Lm:Ab3xYz9"],
  ])("keys %s:%s as %s", async (namespace, shortCode, key) => {
    expect(await linksKey({ namespace, shortCode })).toBe(key);
  });
});

describe("LINKS values", { tags: ["adr-0008", "adr-0028"] }, () => {
  const vectors: [string, LinksValue, string][] = [
    [
      "a live Link with an Expiry",
      {
        state: "live",
        targetUrl: "https://example.com/launch?utm_source=newsletter&utm_medium=email",
        expiresAt: 1798761600000,
        creatorId: "cr_4fK9pQ2xZ7",
        createdAt: 1791244800000,
      },
      '{"v":1,"t":"https://example.com/launch?utm_source=newsletter&utm_medium=email","e":1798761600000,"c":"cr_4fK9pQ2xZ7","ts":1791244800000}',
    ],
    [
      "a live Link without an Expiry",
      { state: "live", targetUrl: "https://example.com/", creatorId: "cr_4fK9pQ2xZ7", createdAt: 1791244800000 },
      '{"v":1,"t":"https://example.com/","c":"cr_4fK9pQ2xZ7","ts":1791244800000}',
    ],
    [
      "a live Link whose Target URL escapes only its quotes and backslash",
      { state: "live", targetUrl: 'web+demo:say "hi"\\there/café/日本', creatorId: "cr_4fK9pQ2xZ7", createdAt: 1791244800000 },
      String.raw`{"v":1,"t":"web+demo:say \"hi\"\\there/café/日本","c":"cr_4fK9pQ2xZ7","ts":1791244800000}`,
    ],
    [
      "a Link its Creator deleted",
      {
        state: "deleted",
        creatorId: "cr_4fK9pQ2xZ7",
        createdAt: 1791244800000,
        deletedAt: 1791331200000,
        deletedBy: "creator",
      },
      '{"v":1,"d":1,"c":"cr_4fK9pQ2xZ7","ts":1791244800000,"dt":1791331200000,"by":"creator"}',
    ],
    [
      "a Link the Operator took down",
      {
        state: "deleted",
        creatorId: "cr_4fK9pQ2xZ7",
        createdAt: 1791244800000,
        deletedAt: 1791331200000,
        deletedBy: "operator",
      },
      '{"v":1,"d":1,"c":"cr_4fK9pQ2xZ7","ts":1791244800000,"dt":1791331200000,"by":"operator"}',
    ],
  ];

  it.each(vectors)("encodes %s", (_, value, json) => {
    expect(encodeLinksValue(value)).toBe(json);
  });

  it.each(vectors)("decodes %s", (_, value, json) => {
    expect(decodeLinksValue(JSON.parse(json))).toEqual(value);
  });

  it.each([
    ["an unknown version", { v: 2, t: "https://example.com/", c: "cr_4fK9pQ2xZ7", ts: 1791244800000 }],
    ["a live value without a Target URL", { v: 1, c: "cr_4fK9pQ2xZ7", ts: 1791244800000 }],
    ["a tombstone without `by`", { v: 1, d: 1, c: "cr_4fK9pQ2xZ7", ts: 1791244800000, dt: 1791331200000 }],
    ["a tombstone with an unknown `by`", { v: 1, d: 1, c: "cr_4fK9pQ2xZ7", ts: 1, dt: 2, by: "visitor" }],
    ["a string", "https://example.com/"],
    ["null", null],
  ])("refuses %s", (_, value) => {
    expect(() => decodeLinksValue(value)).toThrow();
  });
});

describe("keyedCandidate", { tags: ["adr-0009"] }, () => {
  it.each([
    ["cr_4fK9pQ2xZ7", "3f0c9a52-7d1e-4b8a-9c6f-2e5d8b1a4c70", 0, "mTeYY8I"],
    ["cr_4fK9pQ2xZ7", "3f0c9a52-7d1e-4b8a-9c6f-2e5d8b1a4c70", 1, "QSEAueU"],
    ["cr_4fK9pQ2xZ7", "3f0c9a52-7d1e-4b8a-9c6f-2e5d8b1a4c70", 2, "0HLHO9P"],
    ["cr_4fK9pQ2xZ7", "retry-key_0123456789", 0, "YJRbpXE"],
    ["cr_4fK9pQ2xZ7", "retry-key_0123456789", 1, "ZvYcU8r"],
    ["cr_4fK9pQ2xZ7", "retry-key_0123456789", 2, "9MR0bfj"],
    ["cr_4fK9pQ2xZ7", "padding-key-000001", 0, "0sNFPdh"],
  ])("derives candidate %s / %s / %i as %s", async (creatorId, key, candidateIndex, shortCode) => {
    expect(await keyedCandidate(creatorId, key, candidateIndex)).toBe(shortCode);
  });
});

describe("targetUrlSha256", { tags: ["adr-0019"] }, () => {
  it.each([
    ["https://example.com/", "0f115db062b7c0dd030b16878c99dea5c354b49dc37b38eb8846179c7783e9d7"],
    [
      "https://example.com/launch?utm_source=newsletter&utm_medium=email",
      "eb4ab701f2c47ee659afca699c88374f7979402b27d791a0c086c5b300bf6116",
    ],
    ["https://example.com/caf%C3%A9", "d111192409cd9af133e4ad4bf2783397392c82832e36b493fa3c311ff969127c"],
    ["https://xn--bcher-kva.example/", "7971a8be6267ce24bde810901c82e8c4ada53555d5b75e746486b392c1e9eede"],
  ])("hashes %s", async (targetUrl, hash) => {
    expect(await targetUrlSha256(targetUrl)).toBe(hash);
  });
});
