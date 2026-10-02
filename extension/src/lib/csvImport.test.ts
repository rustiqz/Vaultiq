// Test fixtures use fake, obviously-not-real credentials.

import { describe, expect, it } from "vitest";
import { parseCsv, rowsToItems } from "./csvImport.js";

describe("parseCsv", () => {
  it("splits plain rows on commas and newlines", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles a quoted field containing a comma", () => {
    expect(parseCsv('name,notes\n"Acme, Inc.",hello')).toEqual([
      ["name", "notes"],
      ["Acme, Inc.", "hello"],
    ]);
  });

  it("handles an escaped quote inside a quoted field", () => {
    expect(parseCsv('notes\n"she said ""hi"""')).toEqual([["notes"], ['she said "hi"']]);
  });

  it("handles a quoted field containing a newline", () => {
    expect(parseCsv('notes\n"line one\nline two"')).toEqual([["notes"], ["line one\nline two"]]);
  });

  it("accepts CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("flushes a trailing row with no final newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("skips a blank line rather than producing an empty row", () => {
    expect(parseCsv("a,b\n1,2\n\n3,4\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });
});

describe("rowsToItems", () => {
  it("maps a header-less-type export (Chrome-style) to logins", () => {
    const rows = parseCsv(
      "name,url,username,password\nExample,https://example.com,alice,correct-horse-battery-staple",
    );
    const { items, skipped } = rowsToItems(rows);
    expect(skipped).toBe(0);
    expect(items).toEqual([
      {
        type: "login",
        username: "alice",
        password: "correct-horse-battery-staple",
        url: "https://example.com",
        notes: "",
        name: "Example",
      },
    ]);
  });

  it("maps a Bitwarden-style login_* header set", () => {
    const rows = parseCsv(
      "type,name,login_username,login_password,login_uri\nlogin,Example,alice,hunter2,https://example.com",
    );
    const { items } = rowsToItems(rows);
    expect(items).toEqual([
      {
        type: "login",
        username: "alice",
        password: "hunter2",
        url: "https://example.com",
        notes: "",
        name: "Example",
      },
    ]);
  });

  it("maps a type=note row to a secure note", () => {
    const rows = parseCsv('type,name,notes\nnote,"Wifi password","the notes body"');
    const { items, skipped } = rowsToItems(rows);
    expect(skipped).toBe(0);
    expect(items).toEqual([{ type: "note", notes: "the notes body", name: "Wifi password" }]);
  });

  it("skips and counts a row of an unrecognised type", () => {
    const rows = parseCsv("type,name\ncard,My Card");
    const { items, skipped } = rowsToItems(rows);
    expect(items).toEqual([]);
    expect(skipped).toBe(1);
  });

  it("skips and counts a login row with neither username nor password", () => {
    const rows = parseCsv("name,url,username,password\nEmpty,https://example.com,,");
    const { items, skipped } = rowsToItems(rows);
    expect(items).toEqual([]);
    expect(skipped).toBe(1);
  });

  it("skips and counts a note row with no name and no notes", () => {
    const rows = parseCsv("type,name,notes\nnote,,");
    const { items, skipped } = rowsToItems(rows);
    expect(items).toEqual([]);
    expect(skipped).toBe(1);
  });

  it("leaves name out entirely rather than an empty string", () => {
    const rows = parseCsv("url,username,password\nhttps://example.com,alice,hunter2");
    const { items } = rowsToItems(rows);
    expect(items[0]).not.toHaveProperty("name");
  });

  it("matches column names case-insensitively and trims them", () => {
    const rows = parseCsv(" URL , UserName , Password \nhttps://example.com,alice,hunter2");
    const { items } = rowsToItems(rows);
    expect(items).toEqual([
      { type: "login", username: "alice", password: "hunter2", url: "https://example.com", notes: "" },
    ]);
  });

  it("returns nothing for an empty file", () => {
    expect(rowsToItems([])).toEqual({ items: [], skipped: 0 });
  });
});
