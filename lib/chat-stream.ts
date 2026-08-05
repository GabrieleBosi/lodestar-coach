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

export async function readTurnStream(body: ReadableStream<Uint8Array>, h: TurnHandlers) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let startSeen = false;

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
    for (const p of parts) handleSegment(p);

    // Flush text eagerly; only hold back what might be the start of the trailer.
    if (buffer && !META.startsWith(buffer.slice(0, META.length))) {
      h.onText(buffer);
      buffer = "";
    }

    if (done) break;
  }

  if (buffer) handleSegment(buffer);
}
