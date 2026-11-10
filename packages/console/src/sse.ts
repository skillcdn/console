// Server-sent events as a client that is no browser reads them: the runner's stream of signals.
// A browser has `EventSource`; the command has a body to read.

/** One block of a stream of server-sent events. */
export interface SseBlock {
  /** The id the block was sent under, where it was sent under one. */
  readonly id: string | undefined;
  /** What the block is called; `message` where it says nothing. */
  readonly event: string;
  readonly data: string;
}

/** The most one block may be before the stream is given up on: no event of the console's is near it. */
const MAX_BLOCK_LENGTH = 8 * 1024 * 1024;

/** One block's lines as a block, or nothing for one that carries no data: a comment, a keep-alive. */
function blockOf(text: string): SseBlock | undefined {
  let id: string | undefined;
  let event = "message";
  const data: string[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith(":")) {
      continue;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const rest = colon === -1 ? "" : line.slice(colon + 1);
    const value = rest.startsWith(" ") ? rest.slice(1) : rest;
    if (field === "id") {
      id = value;
    } else if (field === "event") {
      event = value;
    } else if (field === "data") {
      data.push(value);
    }
  }
  return data.length === 0 ? undefined : { id, event, data: data.join("\n") };
}

/**
 * The blocks of a body of server-sent events, in order, whatever chunks they arrive in, until
 * the body ends or `signal` says to stop. Comments are left out. The body is released when the
 * reading stops, however it stops.
 */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseBlock> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // Not every body ends by itself when the request that asked for it is given up: a read that
  // waits is ended here.
  const stop = () => {
    void reader.cancel().catch(() => undefined);
  };
  if (signal?.aborted === true) {
    stop();
  }
  signal?.addEventListener("abort", stop, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      // A line ends as the sender ended it; one ending split across two chunks is whole here.
      buffer = `${buffer}${decoder.decode(value, { stream: true })}`.replaceAll("\r\n", "\n");
      for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
        const block = blockOf(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (block !== undefined) {
          yield block;
        }
      }
      if (buffer.length > MAX_BLOCK_LENGTH) {
        throw new Error("a block of the stream is larger than any the console sends");
      }
    }
  } finally {
    signal?.removeEventListener("abort", stop);
    await reader.cancel().catch(() => undefined);
  }
}
