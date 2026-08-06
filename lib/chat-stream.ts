/**
 * Client-side parser for the chat turn stream.
 *
 * Wire format (see `lib/agent/chat.ts`):
 *   line 1            JSON `{ conversationId }`, sent immediately
 *               keepalive, emitted while the agent works (ignored)
 *   …text…            the answer, streamed in chunks
 *   META:{...}  trailing metadata (sources + actions), known only at the end
 */
const CTRL = "\u0000";
const META = "META:";

export interface TurnSource {
  n: number;
  chunkId?: string;
  title: string | null;
  sourceUrl: string | null;
  heading: string | null;
}

export interface TurnAction {
  name: string;
  ok?: boolean;
  summary?: string;
  error?: string;
}

export interface TurnHandlers {
  onStart: (conversationId: string) => void;
  onText: (chunk: string) => void;
  onMeta: (meta: { sources: TurnSource[]; actions: TurnAction[] }) => void;
}

/** Could this partial segment still turn into the metadata trailer? */
function couldStartMeta(partial: string): boolean {
  return partial.startsWith(META) || META.startsWith(partial);
}

export async function readTurnStream(body: ReadableStream<Uint8Array>, h: TurnHandlers) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let startSeen = false;
  let afterCtrl = false;

  const handleSegment = (segment: string) => {
    if (!segment) return;
    if (segment.startsWith(META)) {
      try {
        h.onMeta(JSON.parse(segment.slice(META.length)));
      } catch {
        /* ignore malformed trailer */
      }
      return;
    }
    h.onText(segment);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });

    // The opening frame is a single JSON line terminated by \n.
    if (!startSeen) {
      const nl = buffer.indexOf("\n");
      if (nl === -1) {
        if (done) break;
        continue;
      }
      try {
        h.onStart((JSON.parse(buffer.slice(0, nl)) as { conversationId: string }).conversationId);
      } catch {
        /* ignore */
      }
      buffer = buffer.slice(nl + 1);
      startSeen = true;
    }

    const parts = buffer.split(CTRL);
    buffer = parts.pop() ?? "";
    // The remainder follows a control byte iff this read contained one; with no
    // CTRL in it the remainder is a continuation of whatever it already was.
    if (parts.length > 0) afterCtrl = true;
    for (const p of parts) handleSegment(p);

    // Flush text eagerly. The only reason to hold is a control frame that hasn't
    // been terminated yet — the trailer can be split across reads, and emitting
    // half of it would print `META:{"sourc` into the answer. Text that merely
    // starts with "M" is not held, because it doesn't follow a control byte.
    //
    // The trailer is terminated on both sides (see `lib/agent/chat.ts`), so this
    // hold always resolves mid-stream. It previously did not: an unterminated
    // trailer stayed a plausible prefix forever and rode out to close (P0-5).
    if (buffer && !(afterCtrl && couldStartMeta(buffer))) {
      h.onText(buffer);
      buffer = "";
      afterCtrl = false;
    }

    if (done) break;
  }

  // Backstop for a stream that ends mid-frame. `startSeen` guards against
  // emitting half an opening JSON line as answer text.
  if (startSeen && buffer) handleSegment(buffer);
}
