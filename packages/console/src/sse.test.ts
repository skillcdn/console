import { describe, expect, it } from "vitest";
import { readSse, type SseBlock } from "./sse.js";

/** A body that hands out `chunks` one read at a time. */
function bodyOf(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) {
        controller.close();
      } else {
        controller.enqueue(encoder.encode(chunk));
      }
    },
  });
}

async function all(chunks: readonly string[]): Promise<SseBlock[]> {
  const blocks: SseBlock[] = [];
  for await (const block of readSse(bodyOf(chunks))) {
    blocks.push(block);
  }
  return blocks;
}

describe("readSse", () => {
  it("reads the blocks in order, with what each was sent under, and leaves comments out", async () => {
    expect(
      await all([
        'id: 7\nevent: signal\ndata: {"number":7}\n\n: ping\n\ndata: bare\n\nevent: end\ndata: a\ndata: b\n\n',
      ]),
    ).toEqual([
      { id: "7", event: "signal", data: '{"number":7}' },
      { id: undefined, event: "message", data: "bare" },
      { id: undefined, event: "end", data: "a\nb" },
    ]);
  });

  it("reads a block whole whatever chunks it arrives in, a line ending split in two among them", async () => {
    const text = 'id: 1\r\nevent: signal\r\ndata: {"text":"one"}\r\n\r\nid: 2\ndata: two\n\n';
    for (let size = 1; size <= text.length; size += 1) {
      const chunks: string[] = [];
      for (let at = 0; at < text.length; at += size) {
        chunks.push(text.slice(at, at + size));
      }
      expect(await all(chunks), `in chunks of ${size}`).toEqual([
        { id: "1", event: "signal", data: '{"text":"one"}' },
        { id: "2", event: "message", data: "two" },
      ]);
    }
  });

  it("keeps a character whole that arrives in two chunks, and what a value says after its colon", async () => {
    const bytes = new TextEncoder().encode(`data: a:b ${String.fromCodePoint(0xac00)}\n\n`);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, bytes.length - 3));
        controller.enqueue(bytes.subarray(bytes.length - 3));
        controller.close();
      },
    });
    const blocks: SseBlock[] = [];
    for await (const block of readSse(body)) {
      blocks.push(block);
    }
    expect(blocks).toEqual([
      { id: undefined, event: "message", data: `a:b ${String.fromCodePoint(0xac00)}` },
    ]);
  });

  it("gives nothing for a block left unfinished, and gives up on one larger than any the console sends", async () => {
    expect(await all(["data: whole\n\ndata: cut off"])).toEqual([
      { id: undefined, event: "message", data: "whole" },
    ]);
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024).fill(0x78));
      },
    });
    await expect(
      (async () => {
        for await (const _ of readSse(endless)) {
          // Nothing arrives: the block never ends.
        }
      })(),
    ).rejects.toThrow("larger than any");
  });

  it("stops reading a body that never ends when it is told to", async () => {
    let cancelled = false;
    const silent = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: first\n\n"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const abort = new AbortController();
    const blocks: SseBlock[] = [];
    for await (const block of readSse(silent, abort.signal)) {
      blocks.push(block);
      // Nothing more comes: without the word to stop, the next read would wait for good.
      setTimeout(() => abort.abort(), 10);
    }
    expect(blocks).toEqual([{ id: undefined, event: "message", data: "first" }]);
    expect(cancelled).toBe(true);
    // Told already, it reads nothing.
    const again = new ReadableStream<Uint8Array>({ pull() {} });
    for await (const block of readSse(again, abort.signal)) {
      blocks.push(block);
    }
    expect(blocks).toHaveLength(1);
  });

  it("releases the body when the reading stops early", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("data: again\n\n"));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const block of readSse(body)) {
      expect(block.data).toBe("again");
      break;
    }
    expect(cancelled).toBe(true);
  });
});
