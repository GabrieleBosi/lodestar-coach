/**
 * Client-side parser for the chat turn stream.
 *
 * Wire format (see `lib/agent/chat.ts`):
 *   line 1            JSON `{ conversationId }`, sent immediately
 *               keepalive, emitted while the agent works (ignored)
 *   …text…            answer tokens, forwarded as they are generated
 *   RESET       discard the answer text forwarded so far
 *   META:{...}  trailing metadata (sources + actions), known only at the end
 */
const CTRL = "\u0000";
const META = "META:";
const RESET = "RESET";

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

/**
 * Marker persisted into `messages.tool_calls` when a turn failed to produce an
 * answer.
 *
 * A failed turn used to write no assistant row at all, so on reload it read as
 * an ordinary conversation whose last message happened to be the user's — a
 * missing reply indistinguishable from success (issue #2, P0-4). `messages` has
 * no error column and `role` is CHECK-constrained, so the failure is recorded
 * in the column that already describes what happened during the turn.
 */
export const TURN_FAILED = "__turn_failed__";

/** Did this assistant message record a failed turn rather than an answer? */
export function isFailedTurn(actions: TurnAction[] | undefined): boolean {
  return actions?.some((a) => a.name === TURN_FAILED) ?? false;
}

export interface TurnHandlers {
  onStart: (conversationId: string) => void;
  onText: (chunk: string) => void;
  onMeta: (meta: { sources: TurnSource[]; actions: TurnAction[] }) => void;
  /**
   * Discard every `onText` chunk delivered so far this turn.
   *
   * Answer tokens are forwarded before the agent knows whether the step that
   * produced them will end in a tool call. When it does, that text is not part
   * of the answer and the server retracts it.
   */
  onReset?: () => void;
}

/** Could this partial segment still turn into a control frame? */
function couldStartControl(partial: string): boolean {
  return (
    partial.startsWith(META) ||
    META.startsWith(partial) ||
    (partial.length < RESET.length && RESET.startsWith(partial)) ||
    partial === RESET
  );
}

export async function readTurnStream(body: ReadableStream<Uint8Array>, h: TurnHandlers) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let startSeen = false;
  let afterCtrl = false;

  const handleSegment = (segment: string) => {
    if (!segment) return;
    if (segment === RESET) {
      h.onReset?.();
      return;
    }
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
    // been terminated yet — a frame can be split across reads, and emitting half
    // of it would print `META:{"sourc` into the answer.
    //
    // `afterCtrl` stays set while the remainder is empty, which is correct: the
    // next bytes to arrive really do follow a control byte. The cost is that the
    // first chunk after any control frame — including a keepalive — is held one
    // extra read if it happens to look like the start of "META:" or "RESET". At
    // token cadence that is tens of milliseconds, and it resolves as soon as the
    // chunk grows past the prefix. What it is NOT is the P0-5 stall: that was an
    // unterminated trailer, which stayed a plausible prefix forever and rode out
    // to close no matter how much more arrived.
    if (buffer && !(afterCtrl && couldStartControl(buffer))) {
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
