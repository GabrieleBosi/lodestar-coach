/**
 * Re-runnable check for the chat wire format (`npm run check:stream`).
 *
 * Guards issue #2 P0-5/P0-6: the META trailer must reach the client BEFORE the
 * stream closes. It previously did not. The server sent `CTRL + "META:" + json`
 * with no closing control byte, so `readTurnStream` popped it into `buffer`,
 * and the prefix-hold guard (`!META.startsWith(buffer.slice(0, len))`) is false
 * for exactly a buffer starting "META:" — so it was held until the post-loop
 * flush, which runs after `done`. Chips and Sources therefore waited out the
 * whole memory-extraction tail (~11.7s) no matter what order the server wrote.
 *
 * Replays synthetic streams with a deliberate gap between the last frame and
 * close, and asserts each control frame is handled where it lands. Also covers
 * the split trailer, the RESET retraction, and text that merely looks like a
 * control frame. No network, no model quota.
 */
import { readTurnStream } from "../lib/chat-stream";

const CTRL = "\u0000";
const GAP_MS = 400;

/** Opening frame, then `frames` 50ms apart, then a GAP_MS tail before close. */
function syntheticStream(frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(enc.encode(JSON.stringify({ conversationId: "c1" }) + "\n"));
      for (const f of frames) {
        controller.enqueue(enc.encode(f));
        await new Promise((r) => setTimeout(r, 50));
      }
      await new Promise((r) => setTimeout(r, GAP_MS));
      controller.close();
    },
  });
}

async function run(frames: string[]) {
  const t0 = Date.now();
  let metaAt: number | null = null;
  let textAt: number | null = null;
  let text = "";
  let meta: { sources?: unknown[] } | null = null;

  await readTurnStream(syntheticStream(frames), {
    onStart: () => {},
    onText: (t) => {
      textAt ??= Date.now() - t0;
      text += t;
    },
    onReset: () => {
      text = "";
    },
    onMeta: (m) => {
      metaAt ??= Date.now() - t0;
      meta = m as unknown as { sources?: unknown[] };
    },
  });
  return { textAt, metaAt, closedAt: Date.now() - t0, text, meta };
}

async function main() {
  let failures = 0;
  const check = (ok: boolean, msg: string) => {
    console.log(`  ${ok ? "✅" : "❌"} ${msg}`);
    if (!ok) failures++;
  };

  const payload = JSON.stringify({ sources: [{ n: 1 }], actions: [] });
  const trailer = CTRL + "META:" + payload + CTRL;
  const answer = "A deload week reduces training stress [1].";
  const report = (label: string, r: Awaited<ReturnType<typeof run>>) =>
    console.log(
      `     ${label}: text @${r.textAt}ms · meta @${r.metaAt}ms · close @${r.closedAt}ms`,
    );

  console.log("── terminated trailer (current wire format)");
  const good = await run([answer, trailer]);
  report("single frame", good);
  check(good.metaAt !== null, "META was delivered at all");
  check(
    good.metaAt !== null && good.metaAt < good.closedAt - GAP_MS / 2,
    `META arrived BEFORE close, not with it (meta ${good.metaAt}ms vs close ${good.closedAt}ms)`,
  );
  check(good.text === answer, "the trailer never leaked into the answer text");

  console.log("── unterminated trailer (the P0-5 regression)");
  const bad = await run([answer, CTRL + "META:" + payload]);
  report("no terminator", bad);
  check(
    bad.metaAt !== null && bad.metaAt >= bad.closedAt - 20,
    `reproduces the bug: without a terminator META is stuck until close (meta ${bad.metaAt}ms, close ${bad.closedAt}ms)`,
  );

  // The trailer is one `send()` server-side, but HTTP chunking can still split
  // it. Flushing the partial eagerly would print `META:{"sourc` as answer text.
  console.log("── trailer split across two reads");
  const cut = 12;
  const split = await run([answer, trailer.slice(0, cut), trailer.slice(cut)]);
  report("split trailer", split);
  check(split.text === answer, "no half-trailer leaked into the answer text");
  check(
    split.meta !== null && (split.meta as { sources?: unknown[] }).sources?.length === 1,
    "the reassembled trailer parsed correctly",
  );
  check(
    split.metaAt !== null && split.metaAt < split.closedAt - GAP_MS / 2,
    "the split trailer still arrived before close",
  );

  // The hold must be narrow: text is only ambiguous right after a control byte.
  console.log("── text that merely looks like the trailer");
  const mText = "Metabolic adaptation is real.";
  const mLike = await run([mText, trailer]);
  report("text starts with M", mLike);
  check(mLike.text === mText, `answer text intact ("${mLike.text}")`);
  check(
    mLike.textAt !== null && mLike.textAt < 40,
    `text was NOT stalled waiting to see if it was a trailer (@${mLike.textAt}ms)`,
  );

  // A step's tokens are forwarded before the agent knows whether that step will
  // end in a tool call. When it does, the server retracts them.
  console.log("── retracted step (RESET)");
  const retracted = await run([
    "Let me check your logs.",
    CTRL + "RESET" + CTRL,
    "Your squat is trending up [1].",
    trailer,
  ]);
  report("reset mid-turn", retracted);
  check(
    retracted.text === "Your squat is trending up [1].",
    `only post-reset text survived ("${retracted.text}")`,
  );
  check(retracted.metaAt !== null, "the turn still completed normally after a reset");

  // RESET and META share a prefix-free namespace, but "R"/"RE"/… must not stall
  // ordinary text any more than "M" does.
  console.log("── text that merely looks like RESET");
  const rText = "Recovery takes time.";
  const rLike = await run([rText, trailer]);
  report("text starts with R", rLike);
  check(rLike.text === rText, `answer text intact ("${rLike.text}")`);
  check(
    rLike.textAt !== null && rLike.textAt < 40,
    `text was NOT stalled by the RESET prefix check (@${rLike.textAt}ms)`,
  );

  // Both chat clients treat "the trailer arrived" as the definition of a
  // completed turn. A stream that ends *cleanly* without one — which is what a
  // killed serverless function produces — must therefore never deliver META, or
  // an incomplete turn would re-enable the composer as though it had worked.
  console.log("── a stream that closes without a trailer");
  const noTrailer = await run([answer]);
  report("no trailer at all", noTrailer);
  check(noTrailer.metaAt === null, "META was never delivered, so the turn reads as incomplete");
  check(noTrailer.text === answer, "the partial answer is still delivered, to be labelled");

  console.log("── a stream that closes with nothing at all");
  const empty = await run([]);
  check(empty.metaAt === null, "no META from an empty stream either");
  check(empty.text === "", "and no phantom answer text");

  console.log(failures === 0 ? "\nRESULT: PASS ✅" : `\nRESULT: FAIL ❌ (${failures})`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error("check-stream failed:", e);
  process.exit(1);
});
