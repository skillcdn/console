import {
  type FormEvent,
  memo,
  type NamedExoticComponent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { reasonMoment } from "../agent-state.js";
import {
  type AgentState,
  type FileUpload,
  MAX_FILE_BYTES,
  MAX_SIGNAL_ATTACHMENTS,
  MAX_SIGNAL_LENGTH,
  type RestAgent,
  type RestAgentRunner,
  type RestAgentSecret,
  type RestAgentSession,
  type RestAgentUsageWindow,
  type RestPerson,
  type RestSignal,
  type RestTranscriptEvent,
  usageNear,
  usageSaidTogether,
  usedHundredths,
} from "../api.js";
import { today } from "../dates.js";
import { useWords } from "../i18n/index.js";
import { isPicture } from "./files.js";
import { Markdown } from "./markdown.js";
import { Lightbox, type PictureState, PictureThumb, usePicture } from "./pictures.js";
import { Avatar, Badge, Button, Callout, cx, formatBytes, Meter, personName, Time } from "./ui.js";

// The parts of an agent account's page (ADR-0085, ADR-0086): how it stands, what it is doing as
// it happens, read as a conversation in a pane that follows its end, what a supervisor says to
// it, shown as waiting until the agent takes it, what changes how it stands, its sessions, and
// what its runner said of itself. What the agent said is read as Markdown, rendered to elements
// and never to HTML, with no picture fetched from elsewhere; everything else its product printed,
// a thought, a tool's call and its answer, a note, is shown as text, in a block that keeps its
// spaces and its lines (ADR-0141). What a sub-agent did is read under the call that started it.
// A picture of the session is shown by its address at the console, and any other file is offered
// to save.

/** How an agent stands, in a word, with the tone of it. */
const STATE_TONES: Readonly<Record<AgentState, "success" | "neutral" | "warning" | "danger">> = {
  running: "success",
  stopped: "neutral",
  refused: "warning",
  failed: "danger",
  unheard: "warning",
};

/**
 * What an agent account's product last said of what its subscription allows (ADR-0156): a
 * window a line, by the name its driver gives it, with how much of it is used and when it
 * resets. One near its limit is marked, and one used up. `usage` is the windows that still
 * stand (`usageStanding`); `said` adds when the product said so, where there is room.
 */
export function AgentUsage(props: {
  readonly usage: readonly RestAgentUsageWindow[];
  readonly said?: boolean | undefined;
}) {
  const words = useWords().agents.usage;
  // When they were said: once for all where the product said them together, and beside each
  // where it did not, so that a window kept from days ago does not read as said just now.
  const together = usageSaidTogether(props.usage);
  const said = (iso: string) => (
    <>
      {words.said.before}
      <Time iso={iso} precision="clock" />
      {words.said.after}
    </>
  );
  return (
    <div className="sc-agent-usage">
      {props.usage.map((window, place) => {
        // A name is what a runner sent: read as a word of the pack only where the pack itself
        // holds it, and no key by itself, since two windows may be named alike.
        const name = usageWindowName(words, window.name);
        const near = usageNear(window);
        const hundredths = window.used === null ? undefined : usedHundredths(window.used);
        const resets = window.resetsAt !== null && (
          <>
            {words.resets.before}
            <Time iso={window.resetsAt} precision="week" />
            {words.resets.after}
          </>
        );
        const apart = props.said === true && together === undefined && said(window.at);
        return (
          <Meter
            // biome-ignore lint/suspicious/noArrayIndexKey: the windows are told apart by their place
            key={place}
            label={name}
            share={window.used ?? undefined}
            figure={hundredths === undefined ? (near ? words.near : undefined) : `${hundredths}%`}
            tone={
              hundredths !== undefined && hundredths >= 100
                ? "danger"
                : near
                  ? "warning"
                  : undefined
            }
            note={
              resets === false && apart === false ? undefined : (
                <>
                  {resets}
                  {resets !== false && apart !== false && " · "}
                  {apart}
                </>
              )
            }
          />
        );
      })}
      {props.said === true && together !== undefined && (
        <span className="sc-progress-words">{said(together)}</span>
      )}
    </div>
  );
}

/**
 * The state of an agent account as a badge: the word, and where there is room since when it
 * stands so, right after the word it is the moment of, then why, with when that was said where
 * it is another moment than the state's.
 */
export function AgentStateBadge(props: {
  readonly state: RestAgent["state"];
  /** With since when it stands so, why, and when its runner was last heard from. */
  readonly full?: boolean | undefined;
}) {
  const words = useWords().agents.page.state;
  const state = props.state ?? null;
  if (state === null) {
    // Where there is room, an account no runner has spoken for says so as the others say how they
    // stand: a word in a badge, and why beside it.
    return props.full === true ? (
      <span className="sc-agent-state">
        <Badge tone="neutral" kind="state">
          {words.unset}
        </Badge>
        <span className="sc-note">{words.none}</span>
      </span>
    ) : null;
  }
  const reasons: Readonly<Record<string, string>> = words.reasons;
  const reason = state.reason === null ? undefined : (reasons[state.reason] ?? state.reason);
  const said = reasonMoment(state);
  const badge = (
    <Badge
      tone={STATE_TONES[state.state]}
      kind="state"
      live={state.state === "running"}
      title={reason}
    >
      {words[state.state]}
    </Badge>
  );
  if (props.full !== true) {
    return badge;
  }
  return (
    <span className="sc-agent-state">
      {badge}
      <span className="sc-note">
        {words.since.before}
        <Time iso={state.since} precision="clock" />
        {words.since.after}
        {state.until !== undefined && state.until !== null && (
          <>
            {" · "}
            {words.until.before}
            <Time iso={state.until} precision="clock" />
            {words.until.after}
          </>
        )}
        {reason !== undefined && (
          <>
            {" · "}
            {reason}
            {said !== undefined && (
              <>
                {words.reasonAt.before}
                <Time iso={said} precision="clock" />
                {words.reasonAt.after}
              </>
            )}
          </>
        )}
        {state.heardAt !== null && (
          <>
            {" · "}
            {words.heard} <Time iso={state.heardAt} precision="clock" />
          </>
        )}
      </span>
    </span>
  );
}

export interface TranscriptViewProps {
  readonly events: readonly RestTranscriptEvent[];
  /**
   * What the events are of: the session's id. A text read whole is kept under it, so that it is
   * never shown for the event of the same number in another session. Left out where a view shows
   * one list of events and no other.
   */
  readonly of?: string | undefined;
  /** Where the bytes of a picture of the session are read. */
  readonly fileHref: (fileId: string) => string;
  /** Reads the whole text of an event whose row keeps its beginning alone. */
  readonly onReadWhole?: ((n: number) => Promise<string>) | undefined;
  /** The account whose session this is: its picture stands beside what it said. */
  readonly agent?: RestPerson | undefined;
  /**
   * Whether the session is one whose agent is at work: a sub-agent the record neither answers
   * nor ends is then running, and its row counts its time. Left out, no sub-agent is.
   */
  readonly live?: boolean | undefined;
  /**
   * The files that came with a signal, by its number, where the page has read the account's
   * record: what a supervisor sent that is no picture is offered to save from there.
   */
  readonly signalFiles?: ((number: number) => readonly SignalFile[] | undefined) | undefined;
  /** Where the bytes of a file of a signal are read. */
  readonly signalFileHref?: ((number: number, fileId: string) => string) | undefined;
  readonly empty?: ReactNode;
  /**
   * What stands at the conversation's foot, rows of its list: the words that wait to be taken,
   * and the sign that the agent is at work.
   */
  readonly foot?: ReactNode;
}

/** A file that came with a signal, as the account's record names it. */
export interface SignalFile {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
}

/** What a runner says of an event that is said apart from the rest: the tool it names. */
const TOOL = "tool";

/**
 * One thing of a session as a person reads it: what the agent was told, what woke it, what it
 * said and thought, a tool's call with what it answered and what was asked of it, and a note for
 * everything else, a status, an error, an event that was sealed. A call that started a sub-agent
 * holds what that sub-agent did, as things of its own (ADR-0141).
 */
export type TalkItem =
  | {
      readonly type: "told" | "wake" | "said" | "thought" | "note";
      readonly event: RestTranscriptEvent;
    }
  | {
      readonly type: "tool";
      /** The call, its answer and what was asked before it ran, each where the session has it. */
      readonly call: RestTranscriptEvent | undefined;
      readonly result: RestTranscriptEvent | undefined;
      readonly permission: RestTranscriptEvent | undefined;
      /**
       * What the sub-agent this call started did, in order: the events that name the call as
       * their parent, read as a conversation of their own. Nothing for a call that started none.
       */
      readonly steps?: readonly TalkItem[] | undefined;
      /**
       * When the turn or the session it ran in ended, where that came before its answer; for a
       * sub-agent that goes on in the background, when its session ended before it did.
       */
      readonly endedAt?: string | undefined;
      /**
       * The event of the sub-agent's that says it ended, and how (`over`, ADR-0161): the last
       * of them, and none where the sub-agent did something after it, as one started again does.
       */
      readonly over?: RestTranscriptEvent | undefined;
    };

/** The most characters of a sub-agent's name that a label shows. */
const MAX_SUBAGENT_LABEL = 40;
/** The most characters of a sub-agent's name that its own row shows: what a runner writes of one. */
const MAX_SUBAGENT_NAME = 80;

/** The call an event names as the one that started the sub-agent it is of, or nothing. */
const parentOf = (event: RestTranscriptEvent | undefined): string | undefined => {
  const parent = event?.data.parent;
  return typeof parent === "string" && parent.length > 0 ? parent : undefined;
};

/**
 * Whose an event is, where a sub-agent made it (ADR-0131): what the call that started the
 * sub-agent called it, an empty name where the runner knew only that call, and nothing for an
 * event of the session's own, which is every event of a runner that does not say.
 */
export function subagentOf(event: RestTranscriptEvent | undefined): string | undefined {
  if (parentOf(event) === undefined) {
    return undefined;
  }
  const name = event?.data.subagent;
  return typeof name === "string" ? name.trim().slice(0, MAX_SUBAGENT_LABEL) : "";
}

const idOf = (event: RestTranscriptEvent): string | undefined => {
  const id = event.data.id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
};

/** Whether an event is where a turn ended, or the session did: the record's own word for it. */
const endsTurn = (event: RestTranscriptEvent): boolean =>
  event.kind === "status" &&
  event.sealed === null &&
  (event.data.turn === "completed" || typeof event.data.ended === "string");

/** Whether an event is a sub-agent's word that it ended: a runner writes how under `over` (ADR-0161). */
const saysOver = (event: RestTranscriptEvent): boolean =>
  event.kind === "status" && typeof event.data.over === "string";

/**
 * The kinds of event by which a sub-agent that ended is at work again: what it says, thinks and
 * calls, and its own word that it was started again. A tool's answer is none: a product that
 * stops a sub-agent in the middle of a call says first that it ended, and then what became of
 * the call.
 */
const AT_WORK: ReadonlySet<string> = new Set(["assistant", "thinking", "tool_call", "status"]);

type ToolItem = Extract<TalkItem, { type: "tool" }>;

/**
 * Whether a call was answered with the word that its sub-agent goes on in the background
 * (`background` on its answer, ADR-0161): the answer is then not the sub-agent's, which goes on
 * past it, and past the turn it was started in.
 */
const goesOn = (item: ToolItem): boolean => item.result?.data.background === true;

/** Things in the order they are read: the session's own, or one sub-agent's. */
type TalkLineOf = TalkItem[];

/** Where a tool thing stands: the line it is in, and its place there. */
interface TalkPlace {
  readonly line: TalkLineOf;
  readonly at: number;
}

/**
 * The events of a session as the things a person reads, in order. A tool's call, what it
 * answered and what was asked before it ran are one thing, joined by the id the product gave
 * them; a call under an id whose call is done is another call, as an agent that numbers its
 * calls anew at every turn has it. What carries no id joins the call before it that waits.
 *
 * What a sub-agent did is read under the call that started it (ADR-0141): an event that names a
 * call the session holds as its parent is a step of that call, in a line of the call's own, and
 * not a thing of the line the call stands in. A call that says it starts a sub-agent (`starts`)
 * has such a line from the first, empty; one a runner of before wrote has it from the first
 * event that names it. An event that names a call the events do not hold stays where it stood.
 * A turn or a session that ended ends every sub-agent still open in it, but for one that goes on
 * in the background (ADR-0161): its own line says when it ended, and nothing but its session's
 * end ends it before.
 */
export function talkOf(events: readonly RestTranscriptEvent[]): TalkItem[] {
  const top: TalkLineOf = [];
  /** The tool things that still wait for something, by the id they are open under. */
  const open = new Map<string, TalkPlace>();
  /** The last call under each id, done or not: what a sub-agent's event names as its parent. */
  const calls = new Map<string, TalkPlace>();
  /** The line of each sub-agent, by the id of the call that started it. */
  const lines = new Map<string, TalkLineOf>();
  /** The calls that started a sub-agent that nothing ended yet, as far as the events read say. */
  let running: TalkPlace[] = [];
  const toolAt = (place: TalkPlace | undefined): ToolItem | undefined => {
    const item = place === undefined ? undefined : place.line[place.at];
    return item !== undefined && item.type === "tool" ? item : undefined;
  };
  /** The last tool thing of a line that still waits for an answer, where nothing names an id. */
  const waiting = (line: TalkLineOf): TalkPlace | undefined => {
    for (let at = line.length - 1; at >= 0; at -= 1) {
      const item = line[at];
      if (item === undefined || item.type !== "tool") {
        return undefined;
      }
      if (item.result === undefined) {
        return { line, at };
      }
    }
    return undefined;
  };
  const set = (place: TalkPlace, tool: ToolItem): void => {
    place.line[place.at] = tool;
  };
  const push = (line: TalkLineOf, tool: ToolItem): TalkPlace => {
    line.push(tool);
    return { line, at: line.length - 1 };
  };
  /** The line of the sub-agent a call started, begun where it has none yet. */
  const lineOf = (id: string, place: TalkPlace): TalkLineOf => {
    const begun = lines.get(id);
    if (begun !== undefined) {
      return begun;
    }
    const line: TalkLineOf = [];
    lines.set(id, line);
    const tool = toolAt(place);
    if (tool !== undefined) {
      set(place, { ...tool, steps: line });
      running.push(place);
    }
    return line;
  };
  for (const event of events) {
    // Whose line the event is of: the sub-agent's whose call it names, where the session holds
    // that call, and the session's own otherwise.
    const parent = parentOf(event);
    const starter = parent === undefined ? undefined : calls.get(parent);
    const line = parent === undefined || starter === undefined ? top : lineOf(parent, starter);
    // What a sub-agent's own line says of its end stands until the sub-agent does something
    // after it, as one that was started again does: then it is at work again.
    const begun = toolAt(starter);
    if (starter !== undefined && begun !== undefined && event.sealed === null) {
      const over = saysOver(event) ? event : AT_WORK.has(event.kind) ? undefined : begun.over;
      set(starter, { ...begun, over });
    }
    // A sealed event says who sealed it and why, wherever it stood.
    if (event.sealed !== null) {
      line.push({ type: "note", event });
      continue;
    }
    if (event.kind === "person") {
      line.push({ type: "told", event });
    } else if (event.kind === "wake") {
      line.push({ type: "wake", event });
    } else if (event.kind === "assistant") {
      line.push({ type: "said", event });
    } else if (event.kind === "thinking") {
      line.push({ type: "thought", event });
    } else if (event.kind === "tool_call") {
      const id = idOf(event);
      const held = id === undefined ? undefined : open.get(id);
      const asked = toolAt(held);
      let place: TalkPlace;
      if (held !== undefined && asked !== undefined && asked.call === undefined) {
        set(held, { ...asked, call: event });
        place = held;
      } else {
        place = push(line, { type: "tool", call: event, result: undefined, permission: undefined });
        if (id !== undefined) {
          open.set(id, place);
        }
      }
      if (id !== undefined) {
        // Another call under the id is another call, with a sub-agent of its own or none.
        calls.set(id, place);
        lines.delete(id);
        if (typeof event.data.starts === "string") {
          lineOf(id, place);
        }
      }
    } else if (event.kind === "tool_result") {
      const id = idOf(event);
      const held = id === undefined ? waiting(line) : open.get(id);
      const called = toolAt(held);
      if (held !== undefined && called !== undefined && called.result === undefined) {
        set(held, { ...called, result: event });
        if (id !== undefined) {
          open.delete(id);
        }
      } else {
        line.push({ type: "tool", call: undefined, result: event, permission: undefined });
      }
    } else if (event.kind === "permission") {
      const id = idOf(event);
      const held = id === undefined ? undefined : open.get(id);
      const called = toolAt(held);
      if (
        held !== undefined &&
        called !== undefined &&
        called.permission === undefined &&
        called.result === undefined
      ) {
        set(held, { ...called, permission: event });
      } else {
        const place = push(line, {
          type: "tool",
          call: undefined,
          result: undefined,
          permission: event,
        });
        if (id !== undefined) {
          open.set(id, place);
        }
      }
    } else {
      line.push({ type: "note", event });
      // Where the session's own line says a turn ended, or the session did, nothing started in
      // it goes on: a sub-agent that was not answered by then is ended there. One that goes on
      // in the background goes on past a turn's end, and is ended by its session's alone.
      if (parent === undefined && endsTurn(event)) {
        const session = typeof event.data.ended === "string";
        const still: TalkPlace[] = [];
        for (const place of running) {
          const tool = toolAt(place);
          if (tool === undefined) {
            continue;
          }
          if (goesOn(tool) && !session) {
            still.push(place);
          } else if (
            (goesOn(tool) ? tool.over === undefined : tool.result === undefined) &&
            tool.endedAt === undefined
          ) {
            set(place, { ...tool, endedAt: event.at });
          }
        }
        running = still;
      }
    }
  }
  return top;
}

/**
 * What the agent is at while a turn is under way: thinking, at a tool, or at work between the two.
 */
export type Working =
  | { readonly at: "thinking" | "working" }
  | { readonly at: "tool"; readonly tool: string | undefined };

/** How a sub-agent stands: at work, done, failed, or ended with the turn or the session it ran in. */
export type SubAgentState = "running" | "done" | "failed" | "ended";

/** A sub-agent as the record alone says it (ADR-0141). */
export interface SubAgent {
  /** The number of the event that began it: what it is told apart by. */
  readonly n: number;
  /** What the call that started it calls it; empty where nothing says. */
  readonly name: string;
  readonly startedAt: string;
  readonly state: SubAgentState;
  /** How long it ran, or has run so far, in whole seconds. */
  readonly seconds: number;
  /** How many tools it called. */
  readonly calls: number;
  /** What it is at, while it runs. */
  readonly at: Working | undefined;
}

/** The first event of a thing: what it is numbered and timed by. */
const firstOf = (item: TalkItem): RestTranscriptEvent | undefined =>
  item.type === "tool" ? (item.call ?? item.permission ?? item.result) : item.event;

/** The moments a thing holds, as numbers; none for one that reads as no moment. */
const momentsOf = (item: TalkItem): number[] =>
  (item.type === "tool" ? [item.call, item.permission, item.result] : [item.event]).flatMap(
    (event) => {
      const at = event === undefined ? Number.NaN : Date.parse(event.at);
      return Number.isFinite(at) ? [at] : [];
    },
  );

/** Whether what was asked of a call was answered with anything but leave to run. */
const refusedOf = (item: ToolItem): boolean => {
  const answer = item.permission?.data.answer;
  return typeof answer === "string" && answer.length > 0 && answer !== "allowed";
};

/** What a sub-agent is at, by its steps: its last tool that was not answered, a thought, or the work between. */
function atOf(steps: readonly TalkItem[]): Working {
  for (let at = steps.length - 1; at >= 0; at -= 1) {
    const step = steps[at];
    if (
      step !== undefined &&
      step.type === "tool" &&
      step.call !== undefined &&
      step.result === undefined &&
      !refusedOf(step)
    ) {
      const tool = step.call.data[TOOL];
      return { at: "tool", tool: typeof tool === "string" && tool.length > 0 ? tool : undefined };
    }
  }
  return steps[steps.length - 1]?.type === "thought" ? { at: "thinking" } : { at: "working" };
}

/**
 * The sub-agent a call started, read off the record alone (ADR-0141): what the call calls it, or
 * what its events do where a runner of before wrote them; when it started; how it stands, done
 * or failed by the call's answer, ended where its turn or its session ended first, and at work
 * otherwise, which only an open session's is (`live`); how long it ran, to its answer, to where
 * it was ended or to the last thing it did, and to `now` while it runs; how many tools it
 * called; and what it is at. Nothing for a thing that is no call that started a sub-agent.
 *
 * One that goes on in the background (ADR-0161) is not answered for by its call's answer, which
 * says only that it was started: it stands by its own word that it ended, done, failed or
 * stopped, is ended where its session ended first, and is at work otherwise, whatever turn
 * ended meanwhile.
 */
export function subAgentOf(
  item: TalkItem,
  input: { readonly now: number; readonly live: boolean },
): SubAgent | undefined {
  if (item.type !== "tool" || item.steps === undefined) {
    return undefined;
  }
  const first = firstOf(item);
  if (first === undefined) {
    return undefined;
  }
  const steps = item.steps;
  const said = item.call?.data.starts;
  const named = typeof said === "string" ? said : steps.map(firstOf).find(Boolean)?.data.subagent;
  const name = typeof named === "string" ? named.trim().slice(0, MAX_SUBAGENT_NAME) : "";
  const started = Date.parse(first.at);
  // What the sub-agent answered: the call's answer, but for one that says the sub-agent goes on.
  const answer = goesOn(item) ? undefined : item.result;
  const how = item.over?.data.over;
  const cut = item.endedAt === undefined ? Number.NaN : Date.parse(item.endedAt);
  const state: SubAgentState =
    answer !== undefined
      ? answer.data.error === true
        ? "failed"
        : "done"
      : item.over !== undefined
        ? how === "failed"
          ? "failed"
          : how === "stopped"
            ? "ended"
            : "done"
        : item.endedAt !== undefined || refusedOf(item) || !input.live
          ? "ended"
          : "running";
  const until =
    state === "running"
      ? input.now
      : answer !== undefined
        ? Date.parse(answer.at)
        : item.over !== undefined
          ? Date.parse(item.over.at)
          : item.endedAt !== undefined
            ? cut
            : Math.max(started, ...steps.flatMap(momentsOf));
  const seconds = Math.floor((until - started) / 1000);
  return {
    n: first.n,
    name,
    startedAt: first.at,
    state,
    seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 0,
    calls: steps.filter((step) => step.type === "tool" && step.call !== undefined).length,
    at: state === "running" ? atOf(steps) : undefined,
  };
}

/** The sub-agents among things and under them, in the order they were started. */
function subAgentsIn(
  items: readonly TalkItem[],
  input: { readonly now: number; readonly live: boolean },
): SubAgent[] {
  return items.flatMap((item) => {
    const one = subAgentOf(item, input);
    return one === undefined || item.type !== "tool"
      ? []
      : [one, ...subAgentsIn(item.steps ?? [], input)];
  });
}

/**
 * The sub-agents at work in an open session, read off its events alone, in the order they were
 * started: those a call of the turn under way started that was not answered yet, and those that
 * go on in the background, whatever turn started them, until each says it ended (ADR-0161).
 * None where the session has no event; none but those in the background where its last turn is
 * over.
 */
export function atWorkOf(events: readonly RestTranscriptEvent[], now: number): readonly SubAgent[] {
  return subAgentsIn(talkOf(events), { now, live: true }).filter((one) => one.state === "running");
}

/**
 * Whether the events read hold what a sub-agent did and not the call that started it: the call
 * then stands before them, as it does once a sub-agent has worked for long, and what it did is
 * read under it only once the events before are read too.
 */
export function lacksStarter(events: readonly RestTranscriptEvent[]): boolean {
  const calls = new Set<string>();
  for (const event of events) {
    const id = event.kind === "tool_call" ? idOf(event) : undefined;
    if (id !== undefined) {
      calls.add(id);
    }
  }
  return events.some((event) => {
    const parent = parentOf(event);
    return parent !== undefined && !calls.has(parent);
  });
}

/**
 * Whether a turn is under way, and what the agent is at, read off a session's events alone:
 * the record says where a turn ends (`turn: "completed"` on a status) and where the session
 * does, so whatever follows the last of those is a turn that is not done. Nothing where the
 * session has no event yet, or its last turn is over. What a sub-agent does says nothing of
 * what the agent itself is at, which is the call that started it: its events are passed over.
 */
export function workingOf(events: readonly RestTranscriptEvent[]): Working | undefined {
  /** The calls that were answered, by the id the product gave them. */
  const answered = new Set<string>();
  for (let at = events.length - 1; at >= 0; at -= 1) {
    const event = events[at];
    if (event === undefined || event.sealed !== null || parentOf(event) !== undefined) {
      continue;
    }
    if (event.kind === "status") {
      if (event.data.turn === "completed" || typeof event.data.ended === "string") {
        return undefined;
      }
      continue;
    }
    if (event.kind === "tool_result") {
      const id = idOf(event);
      if (id === undefined) {
        return { at: "working" };
      }
      answered.add(id);
      continue;
    }
    if (event.kind === "tool_call") {
      const id = idOf(event);
      return id !== undefined && answered.has(id)
        ? { at: "working" }
        : { at: "tool", tool: word(event.data[TOOL]) };
    }
    if (event.kind === "permission") {
      continue;
    }
    if (event.kind === "error") {
      return undefined;
    }
    if (answered.size > 0) {
      return { at: "working" };
    }
    return event.kind === "assistant" ? { at: "working" } : { at: "thinking" };
  }
  return undefined;
}

/** The number of the last signal a session's events say the agent took, or nothing where none says. */
export function takenOf(events: readonly RestTranscriptEvent[]): number | undefined {
  let most: number | undefined;
  for (const event of events) {
    const number = event.data.signal;
    if (
      (event.kind === "person" || event.kind === "wake") &&
      typeof number === "number" &&
      (most === undefined || number > most)
    ) {
      most = number;
    }
  }
  return most;
}

/**
 * The words sent that the agent has not taken: the tells, the interrupts that carry words or
 * files, and the resets that carry words, a supervisor's or the account's own (ADR-0154),
 * which a new conversation begins with, after the last signal the record says it took, the
 * oldest first. A signal is taken in order, so everything up to that one was.
 */
export function waitingOf(signals: readonly RestSignal[], taken: number): readonly RestSignal[] {
  return signals
    .filter(
      (signal) =>
        signal.number > taken &&
        signal.source === "person" &&
        (signal.kind === "tell" || signal.kind === "interrupt" || signal.kind === "reset") &&
        (signal.text.trim().length > 0 || signal.attachments.length > 0),
    )
    .slice()
    .sort((a, b) => a.number - b.number);
}

/** Whether a signal is a reset the account itself sent (ADR-0154): who sent it tells it from a supervisor's. */
export const isOwnReset = (signal: RestSignal, account: string): boolean =>
  signal.kind === "reset" && signal.source === "person" && signal.by?.id === account;

/**
 * The account's own reset that waits (ADR-0154), or nothing. It waits for the turn under way
 * to end, whatever its product takes in a turn and whatever was taken after it, so the count
 * of what was taken does not say it: taking it ends the session, so one sent since the open
 * session began waits still, the last of them standing for those before it. `began` is when
 * the open session began; with none open, nothing waits so.
 */
export function ownResetWaiting(
  signals: readonly RestSignal[],
  account: string,
  began: string | undefined,
): RestSignal | undefined {
  const from = began === undefined ? Number.NaN : Date.parse(began);
  return signals
    .filter((signal) => isOwnReset(signal, account) && Date.parse(signal.at) >= from)
    .sort((a, b) => a.number - b.number)
    .at(-1);
}

/** The texts read whole in a session: the session they were read in, and each by its event's number. */
export interface WholeTexts {
  readonly of: string | undefined;
  readonly texts: Readonly<Record<number, string>>;
}

/** Nothing read whole yet. */
export const NO_WHOLE: WholeTexts = { of: undefined, texts: {} };

/**
 * The whole text of an event, where it was read whole in the session shown. Every session
 * numbers its events from one, so a text read in another session is another event's, and is
 * never answered for this one.
 */
export function wholeOf(kept: WholeTexts, of: string | undefined, n: number): string | undefined {
  return kept.of === of ? kept.texts[n] : undefined;
}

/** What is kept once a text was read whole in a session: with the others read in it, without those of another. */
export function withWhole(
  kept: WholeTexts,
  of: string | undefined,
  n: number,
  text: string,
): WholeTexts {
  return { of, texts: { ...(kept.of === of ? kept.texts : {}), [n]: text } };
}

/**
 * A session's events with the ones before them put first: those up to where the events shown
 * begin, and none that is shown already, so that a page read twice adds its events once.
 */
export function withEarlier(
  current: readonly RestTranscriptEvent[],
  earlier: readonly RestTranscriptEvent[],
  from: number,
): readonly RestTranscriptEvent[] {
  const shown = new Set(current.map((event) => event.n));
  return [...earlier.filter((event) => event.n <= from && !shown.has(event.n)), ...current];
}

/** How far from its end a conversation may stand and still be followed, in pixels. */
export const FOLLOW_SLACK = 72;

/** Whether whoever reads a pane is at its end, give or take a line: there the pane follows what arrives. */
export function followsEnd(pane: {
  readonly scrollHeight: number;
  readonly scrollTop: number;
  readonly clientHeight: number;
}): boolean {
  return pane.scrollHeight - pane.scrollTop - pane.clientHeight <= FOLLOW_SLACK;
}

/**
 * Whether a pane goes on following its end once it scrolled: at its end it does; away from it
 * by the hand of whoever reads, a wheel, a finger, a key or the bar, it does not; and away from
 * it by itself it goes on as it was. A pane moves by itself whenever the conversation changes
 * how tall it is, taller by what arrives and shorter while it is read again, and it is told so
 * after the fact, when the conversation may have changed once more: where the pane stands says
 * nothing then of who moved it.
 */
export function followsAfter(
  following: boolean,
  byHand: boolean,
  pane: {
    readonly scrollHeight: number;
    readonly scrollTop: number;
    readonly clientHeight: number;
  },
): boolean {
  if (followsEnd(pane)) {
    return true;
  }
  return byHand ? false : following;
}

/** How long after a wheel, a touch, a key or a press on the pane a scroll is taken for the reader's own, in milliseconds. */
export const HAND_MS = 1200;

/** The first line of a text, for a row that shows one: cut where it is long. */
function firstLine(text: string, most = 160): string {
  const line = text.split("\n").find((one) => one.trim().length > 0) ?? "";
  return line.length > most ? `${line.slice(0, most)}…` : line;
}

/**
 * The first line of what was said, for a row that shows one: without the marks its Markdown
 * begins a heading, a quotation or an item of a list with, and those it sets code and weight
 * off by, which a line alone would show bare.
 */
export function saidLine(text: string): string {
  const line = text.split("\n").find((one) => one.trim().length > 0) ?? "";
  return firstLine(
    line
      .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d{1,9}[.)]\s+)/, "")
      .replaceAll("**", "")
      .replaceAll("`", ""),
  );
}

/** A fact of an event as a word, or nothing where it is none. */
const word = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/**
 * A window of an allowance by the words a person has for it (ADR-0156): the plan's two by the
 * pack's words, and a window of a part of the allowance, which a driver names by the plan's
 * window with what it is of after it (`weekly fable`), as that window's word with the rest
 * beside it, "Week (Fable)". Any other name is what a runner sent, and is shown as it came.
 */
export function usageWindowName(
  words: {
    readonly windows: Readonly<Record<string, string>>;
    readonly windowOf: (window: string, of: string) => string;
  },
  name: string,
): string {
  if (Object.hasOwn(words.windows, name)) {
    return words.windows[name] ?? name;
  }
  const space = name.indexOf(" ");
  const window = space > 0 ? name.slice(0, space) : "";
  const of = space > 0 ? name.slice(space + 1).trim() : "";
  return Object.hasOwn(words.windows, window) && of !== ""
    ? words.windowOf(words.windows[window] ?? window, `${of.charAt(0).toUpperCase()}${of.slice(1)}`)
    : name;
}

/**
 * What the record names in a word of its own, a signal's kind, an answer, a fact's name, in the
 * page's words: the pack's word for it, or the word as it came where the pack has none, as for
 * what a newer runner writes. Only a word the pack itself holds counts: what a runner sends is
 * data, and a name every object has is no word of the pack.
 */
export function wordOf(words: Readonly<Record<string, string>>, name: string): string {
  return Object.hasOwn(words, name) ? (words[name] ?? name) : name;
}

/** A length of time as a clock says it, from whole seconds: `0:07`, `12:40`, `1:02:05`. */
export function clockOf(seconds: number): string {
  const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const two = (value: number): string => String(value).padStart(2, "0");
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  return hours > 0
    ? `${hours}:${two(minutes)}:${two(whole % 60)}`
    : `${minutes}:${two(whole % 60)}`;
}

/**
 * How long something has run since a moment, as a clock that ticks by itself: the page counts
 * the seconds, and the record is not read again for them.
 */
function RunningFor(props: { readonly since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <>{clockOf((now - Date.parse(props.since)) / 1000)}</>;
}

/** What an agent or a sub-agent is at, in the page's words: a thought, a tool by its name, or the work between. */
function workingWord(
  words: {
    readonly thinking: string;
    readonly working: string;
    readonly tool: (name: string) => string;
  },
  working: Working | undefined,
): string {
  if (working === undefined) {
    return words.working;
  }
  if (working.at === "tool") {
    return working.tool === undefined ? words.working : words.tool(working.tool);
  }
  return words[working.at];
}

/**
 * What every line of a conversation is handed, the same from one render of the view to the
 * next, so that a line is drawn again only when what it shows changed.
 */
export interface TalkHands {
  /** Where the bytes of a picture of the session are read. */
  readonly fileHref: (fileId: string) => string;
  /** Where the bytes of a file of a signal are read, where the view was told. */
  readonly signalFileHref: ((number: number, fileId: string) => string) | undefined;
  /** Reads the whole text of an event, where the view can. */
  readonly readWhole: ((n: number) => void) | undefined;
  readonly openPicture: PictureState["open"];
}

export interface TalkLineProps {
  readonly one: TalkItem;
  readonly hands: TalkHands;
  /** The account's picture, beside what it said. */
  readonly agent: RestPerson | undefined;
  /** When the turn the line ends began, for a line that ends one. */
  readonly began: string | undefined;
  /** The files that came with what the agent was told, as the account's record names them. */
  readonly files: readonly SignalFile[] | undefined;
  /** The line's text read whole: its own, or its call's for a tool. */
  readonly whole: string | undefined;
  /** A tool's answer read whole. */
  readonly wholeAnswer: string | undefined;
  /** The event of the line whose whole text is being read, by its number. */
  readonly reading: number | undefined;
  /** The day it is: a moment of today is said by its hour alone, so a new day draws the lines again. */
  readonly today: string;
  /**
   * When the line before this one was: a line of the same day says its hour alone, and the day
   * is said once, on the first line of it. The first line is read against today.
   */
  readonly after: string | undefined;
  /**
   * What the sub-agent the line's call started did, a line each, for a call that started one
   * (ADR-0141): drawn inside the line, each again only when it changed.
   */
  readonly steps?: readonly TalkStep[] | undefined;
  /**
   * For a call that started a sub-agent: whether the session is one whose agent is at work, so
   * that a sub-agent the record does not end is running. Said on no other line.
   */
  readonly live?: boolean | undefined;
  /** Whether the line stands under the sub-agent that made it: whose it is, is then not said again. */
  readonly inside?: boolean | undefined;
}

/** A line of a conversation with the number it is told apart by. */
export type TalkStep = TalkLineProps & { readonly key: number };

/** Whether two things of a session are the same events: a thing is made anew each time the events are read through. */
function sameItem(a: TalkItem, b: TalkItem): boolean {
  if (a.type === "tool" || b.type === "tool") {
    // What a sub-agent did is compared as the lines it is drawn in, and not here.
    return (
      a.type === "tool" &&
      b.type === "tool" &&
      a.call === b.call &&
      a.result === b.result &&
      a.permission === b.permission &&
      a.endedAt === b.endedAt &&
      a.over === b.over
    );
  }
  return a.type === b.type && a.event === b.event;
}

/** Whether two lists of a signal's files name the same files: the record is read again every few seconds. */
function sameFiles(
  a: readonly SignalFile[] | undefined,
  b: readonly SignalFile[] | undefined,
): boolean {
  if (a === b) {
    return true;
  }
  return (
    a !== undefined &&
    b !== undefined &&
    a.length === b.length &&
    a.every((file, index) => {
      const other = b[index];
      return (
        other !== undefined &&
        file.id === other.id &&
        file.name === other.name &&
        file.size === other.size &&
        file.contentType === other.contentType
      );
    })
  );
}

/** Whether the lines of two sub-agents would be drawn the same: as many, each the same line. */
function sameSteps(
  a: readonly TalkStep[] | undefined,
  b: readonly TalkStep[] | undefined,
): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return (
    a.length === b.length &&
    a.every((line, index) => {
      const other = b[index];
      return other !== undefined && line.key === other.key && sameLine(line, other);
    })
  );
}

/** Whether a line would be drawn the same: then it is not drawn again. */
export function sameLine(a: TalkLineProps, b: TalkLineProps): boolean {
  return (
    sameItem(a.one, b.one) &&
    a.hands === b.hands &&
    a.agent === b.agent &&
    a.began === b.began &&
    sameFiles(a.files, b.files) &&
    a.whole === b.whole &&
    a.wholeAnswer === b.wholeAnswer &&
    a.reading === b.reading &&
    a.today === b.today &&
    a.after === b.after &&
    a.live === b.live &&
    a.inside === b.inside &&
    sameSteps(a.steps, b.steps)
  );
}

/** When the turn an event ends began, by the event's number: the first thing the agent was sent after the turn before. */
export function turnStarts(events: readonly RestTranscriptEvent[]): ReadonlyMap<number, string> {
  const starts = new Map<number, string>();
  let since: string | undefined;
  for (const event of events) {
    if (event.kind === "status" && event.data.turn === "completed") {
      if (since !== undefined) {
        starts.set(event.n, since);
      }
      since = undefined;
    } else if ((event.kind === "person" || event.kind === "wake") && since === undefined) {
      since = event.at;
    }
  }
  return starts;
}

/**
 * What each line of a conversation is given, in order, with the number it is told apart by:
 * its own events, and of everything the view holds only what the line itself shows, so that a
 * line's props say the same until the line would be drawn otherwise. A call that started a
 * sub-agent is given the lines of what that sub-agent did, made the same way.
 */
export function talkLinesOf(input: {
  readonly items: readonly TalkItem[];
  readonly hands: TalkHands;
  readonly agent: RestPerson | undefined;
  readonly began: ReadonlyMap<number, string>;
  readonly signalFiles: TranscriptViewProps["signalFiles"];
  readonly whole: WholeTexts;
  /** The session the events are of. */
  readonly of: string | undefined;
  /** The event whose whole text is being read, by its number. */
  readonly reading: number | undefined;
  readonly today: string;
  /** Whether the session is one whose agent is at work: left out, it is not. */
  readonly live?: boolean | undefined;
}): readonly TalkStep[] {
  const { whole, of, reading } = input;
  const linesOf = (
    items: readonly TalkItem[],
    inside: boolean,
    from: string | undefined,
  ): TalkStep[] => {
    let before = from;
    return items.flatMap((one) => {
      const main = one.type === "tool" ? one.call : one.event;
      const answer = one.type === "tool" ? one.result : undefined;
      const first = firstOf(one);
      if (first === undefined) {
        return [];
      }
      const signal = one.type === "told" ? one.event.data.signal : undefined;
      const after = before;
      before = first.at;
      const steps =
        one.type === "tool" && one.steps !== undefined
          ? { steps: linesOf(one.steps, true, first.at), live: input.live === true }
          : {};
      return [
        {
          key: first.n,
          one,
          hands: input.hands,
          // The account's picture stands beside what it said, and nowhere else: what a
          // sub-agent said is a step, with no picture, and is not drawn again for one.
          agent:
            one.type === "said" && subagentOf(one.event) === undefined ? input.agent : undefined,
          began: one.type === "tool" ? undefined : input.began.get(one.event.n),
          files: typeof signal === "number" ? input.signalFiles?.(signal) : undefined,
          whole: main === undefined ? undefined : wholeOf(whole, of, main.n),
          wholeAnswer: answer === undefined ? undefined : wholeOf(whole, of, answer.n),
          reading:
            reading !== undefined && (reading === main?.n || reading === answer?.n)
              ? reading
              : undefined,
          today: input.today,
          after,
          ...steps,
          ...(inside ? { inside: true } : {}),
        },
      ];
    });
  };
  return linesOf(input.items, false, undefined);
}

/**
 * One line of a conversation. It is drawn again only when its own events, its own texts read
 * whole or what it is handed changed: a session of thousands of events draws one line for an
 * event that arrives, not all of them.
 */
const TalkLine: NamedExoticComponent<TalkLineProps> = memo(function Line(
  props: TalkLineProps,
): ReactNode {
  const all = useWords();
  const words = all.agents.page.live;
  const { one, hands } = props;
  const kinds: Readonly<Record<string, string>> = words.kinds;
  /**
   * The words of an event, whole where they were read whole, with the way to read the rest: as
   * text that keeps its spaces and its lines, or, for what the agent said (`said`), as Markdown
   * rendered to elements, with no picture fetched (ADR-0141).
   */
  const text = (
    event: RestTranscriptEvent,
    className: string,
    read: string | undefined,
    said = false,
  ): ReactNode => {
    const shown = read ?? event.text;
    const readWhole = hands.readWhole;
    return (
      <>
        {shown.length > 0 &&
          (said ? (
            <Markdown source={shown} picturesAsLinks />
          ) : (
            <pre className={className}>{shown}</pre>
          ))}
        {event.whole !== null && read === undefined && (
          <p className="sc-talk-cut sc-fine">
            {words.cutAt(formatBytes(event.whole))}{" "}
            {readWhole !== undefined && (
              <Button
                variant="ghost"
                size="sm"
                disabled={props.reading === event.n}
                onClick={() => readWhole(event.n)}
              >
                {words.whole}
              </Button>
            )}
          </p>
        )}
      </>
    );
  };
  const pictures = (event: RestTranscriptEvent | undefined): ReactNode =>
    event === undefined || event.files.length === 0 ? null : (
      <ul className="sc-talk-pictures">
        {event.files.map((file) => (
          <li key={file.id}>
            <PictureThumb
              picture={{
                src: hands.fileHref(file.id),
                alt: file.name,
                name: file.name,
                size: file.size,
              }}
              onOpen={hands.openPicture}
            />
          </li>
        ))}
      </ul>
    );
  const when = (event: RestTranscriptEvent): ReactNode => (
    <Time iso={event.at} precision="clock" against={props.after} />
  );
  if (one.type === "tool") {
    const first = one.call ?? one.permission ?? one.result;
    if (first === undefined) {
      return null;
    }
    const name = word(one.call?.data[TOOL]) ?? word(one.permission?.data[TOOL]);
    const failed = one.result?.data.error === true;
    const answer = word(one.permission?.data.answer);
    const refused = answer !== undefined && answer !== "allowed";
    const line = firstLine(one.call?.text ?? one.permission?.text ?? one.result?.text ?? "");
    // Whose the call is, where a sub-agent made it: read off the line's own events, as
    // everything a line shows is, so that it is drawn again only when they are others. Under
    // the sub-agent that made it, it is not said again.
    const sub = props.inside === true ? undefined : subagentOf(first);
    // A call that started a sub-agent is that sub-agent's row: what it is called, how much it
    // did and how it stands; opened, what it was started with, what it did, a line each, and
    // what it answered.
    const started = subAgentOf(one, { now: 0, live: props.live === true });
    if (started !== undefined) {
      const steps = props.steps ?? [];
      const calls = words.agent.calls(started.calls);
      // What it is called: by the call, by its events, or as the tool that started it is.
      const called = started.name.length === 0 ? (name ?? kinds.tool_call) : started.name;
      return (
        <li
          className={cx(
            "sc-talk-item",
            "sc-talk-step",
            "sc-talk-tool",
            (started.state === "failed" || refused) && "sc-talk-tool-failed",
          )}
          data-n={first.n}
        >
          <details className="sc-talk-tool-fold">
            <summary className="sc-talk-tool-head sc-talk-agent-head">
              <span className="sc-name sc-talk-agent-name" title={called}>
                {called}
              </span>
              {sub !== undefined && <Badge>{words.subagent(sub)}</Badge>}
              {refused ? (
                <Badge tone="warning">{words.toolRefused}</Badge>
              ) : started.state === "running" ? (
                <Badge tone="success" kind="state" live>
                  {words.agent.states.running}
                </Badge>
              ) : started.state === "failed" ? (
                <Badge tone="danger">{words.agent.states.failed}</Badge>
              ) : (
                <Badge>{words.agent.states[started.state]}</Badge>
              )}
              {when(first)}
              <span className="sc-muted sc-talk-agent-facts">
                <span className="sc-talk-kind">{words.agent.label}</span>
                {started.state === "running" ? (
                  <>
                    {workingWord(words.working, started.at)} · {calls} ·{" "}
                    <RunningFor since={started.startedAt} />
                  </>
                ) : (
                  `${calls} · ${clockOf(started.seconds)}`
                )}
              </span>
            </summary>
            <div className="sc-talk-tool-body">
              {one.permission !== undefined && (
                <p className="sc-talk-note-line">
                  {kinds.permission}
                  {answer === undefined ? "" : ` · ${wordOf(words.answers, answer)}`}
                  {one.permission.text.length > 0 && ` · ${one.permission.text}`}
                </p>
              )}
              {one.call !== undefined && text(one.call, "sc-talk-code", props.whole)}
              {steps.length > 0 && (
                <ol className="sc-talk sc-talk-steps" aria-label={words.agent.steps}>
                  {steps.map(({ key, ...step }) => (
                    <TalkLine key={key} {...step} />
                  ))}
                </ol>
              )}
              {one.result !== undefined &&
                text(one.result, "sc-talk-code sc-talk-code-answer", props.wholeAnswer)}
            </div>
          </details>
          {pictures(one.result)}
        </li>
      );
    }
    return (
      <li
        className={cx(
          "sc-talk-item",
          "sc-talk-step",
          "sc-talk-tool",
          (failed || refused) && "sc-talk-tool-failed",
        )}
        data-n={first.n}
      >
        <details className="sc-talk-tool-fold">
          <summary className="sc-talk-tool-head">
            <code className="sc-talk-tool-name">{name ?? kinds.tool_call}</code>
            <span className="sc-talk-tool-line">{line}</span>
            {sub !== undefined && <Badge>{words.subagent(sub)}</Badge>}
            {failed && <Badge tone="danger">{words.toolFailed}</Badge>}
            {refused && <Badge tone="warning">{words.toolRefused}</Badge>}
            {one.result === undefined && one.call !== undefined && !refused && (
              <span className="sc-muted">{words.toolRunning}</span>
            )}
            {when(first)}
          </summary>
          <div className="sc-talk-tool-body">
            {one.permission !== undefined && (
              <p className="sc-talk-note-line">
                {kinds.permission}
                {answer === undefined ? "" : ` · ${wordOf(words.answers, answer)}`}
                {one.permission.text.length > 0 && ` · ${one.permission.text}`}
              </p>
            )}
            {one.call !== undefined && text(one.call, "sc-talk-code", props.whole)}
            {one.result !== undefined &&
              text(one.result, "sc-talk-code sc-talk-code-answer", props.wholeAnswer)}
          </div>
        </details>
        {pictures(one.result)}
      </li>
    );
  }
  const { event } = one;
  if (event.sealed !== null) {
    return (
      <li className="sc-talk-item sc-talk-note sc-fine" data-n={event.n}>
        <span className="sc-talk-note-line">
          {words.sealed(
            event.sealed.by === null ? "?" : (event.sealed.by.name ?? event.sealed.by.login),
            event.sealed.reason,
          )}
        </span>
        {when(event)}
      </li>
    );
  }
  if (one.type === "told") {
    const number = typeof event.data.signal === "number" ? event.data.signal : undefined;
    const kind = word(event.data.kind);
    const through = word(event.data.agent);
    const unseen = word(event.data.unseen);
    const others = word(event.data.files);
    const listed =
      number === undefined
        ? undefined
        : props.files?.filter((file) => !isPicture(file.contentType));
    const who = word(event.data.by) ?? words.kinds.person;
    // An interrupt with no words of its own stopped the turn so that what waited is read: a
    // note of who did, and no message.
    if (
      kind === "interrupt" &&
      event.text.length === 0 &&
      event.files.length === 0 &&
      others === undefined
    ) {
      return (
        <li className="sc-talk-item sc-talk-note sc-fine" data-n={event.n}>
          <span className="sc-talk-note-line">
            {words.interrupted(who)}
            {when(event)}
          </span>
        </li>
      );
    }
    const signalFileHref = hands.signalFileHref;
    return (
      <li className="sc-talk-item sc-talk-told" data-n={event.n}>
        <div className="sc-talk-bubble">
          {text(event, "sc-talk-text", props.whole)}
          {pictures(event)}
          {listed !== undefined && listed.length > 0 ? (
            <ul className="sc-chosen-files" aria-label={words.files}>
              {listed.map((file) => (
                <li key={file.id} className="sc-chosen-file">
                  {signalFileHref === undefined || number === undefined ? (
                    <span>{file.name}</span>
                  ) : (
                    <a href={signalFileHref(number, file.id)} download={file.name}>
                      {file.name}
                    </a>
                  )}{" "}
                  <span className="sc-muted">{formatBytes(file.size)}</span>
                </li>
              ))}
            </ul>
          ) : (
            others !== undefined && (
              <p className="sc-talk-note-line">
                {words.files}: {others}
              </p>
            )
          )}
          {unseen !== undefined && (
            <p className="sc-talk-note-line sc-talk-unseen">{words.unseen(unseen)}</p>
          )}
        </div>
        <div className="sc-talk-meta sc-fine">
          <span className="sc-name">{who}</span>
          {through !== undefined && <span>{words.through(through)}</span>}
          {kind !== undefined && kind !== "tell" && (
            <Badge>{wordOf(words.signalKinds, kind)}</Badge>
          )}
          {when(event)}
        </div>
        {event.data.unread === true && (
          <p className="sc-talk-note-line sc-talk-unread">{words.unread}</p>
        )}
      </li>
    );
  }
  if (one.type === "said") {
    const sub = subagentOf(event);
    // What a sub-agent said is a step of the work, and not the agent's word to whoever reads:
    // folded as a thought is, under the sub-agent's name where it stands apart from its row.
    if (sub !== undefined) {
      return (
        <li className="sc-talk-item sc-talk-step sc-talk-thought" data-n={event.n}>
          <details className="sc-talk-tool-fold">
            <summary className="sc-talk-tool-head">
              <span className="sc-talk-kind">{kinds.assistant}</span>
              <span className="sc-talk-tool-line">{saidLine(event.text)}</span>
              {props.inside !== true && <Badge>{words.subagent(sub)}</Badge>}
              {when(event)}
            </summary>
            <div className="sc-talk-tool-body">
              {text(event, "sc-talk-text", props.whole, true)}
              {pictures(event)}
            </div>
          </details>
        </li>
      );
    }
    return (
      <li className="sc-talk-item sc-talk-said" data-n={event.n}>
        {props.agent !== undefined && <Avatar person={props.agent} size="sm" />}
        <div className="sc-talk-prose">
          {text(event, "sc-talk-text", props.whole, true)}
          {pictures(event)}
        </div>
        {when(event)}
      </li>
    );
  }
  if (one.type === "thought") {
    const sub = props.inside === true ? undefined : subagentOf(event);
    return (
      <li className="sc-talk-item sc-talk-step sc-talk-thought" data-n={event.n}>
        <details className="sc-talk-tool-fold">
          <summary className="sc-talk-tool-head">
            <span className="sc-talk-kind">{kinds.thinking}</span>
            <span className="sc-talk-tool-line">{firstLine(event.text)}</span>
            {sub !== undefined && <Badge>{words.subagent(sub)}</Badge>}
            {when(event)}
          </summary>
          <div className="sc-talk-tool-body">{text(event, "sc-talk-text", props.whole)}</div>
        </details>
      </li>
    );
  }
  // Where a turn ended: a line, with how long the agent was at it where the record says when it began.
  if (event.kind === "status" && event.data.turn === "completed") {
    const from = props.began;
    const seconds =
      from === undefined
        ? undefined
        : Math.max(0, Math.round((Date.parse(event.at) - Date.parse(from)) / 1000));
    return (
      <li className="sc-talk-item sc-talk-turn" data-n={event.n}>
        <span className="sc-talk-note-line">
          {words.turnDone(Number.isFinite(seconds) ? seconds : undefined)}
          {when(event)}
        </span>
      </li>
    );
  }
  // A wake, a status, an error, and whatever a newer runner calls otherwise: a note between.
  // What the note's own words say already, how a session or a sub-agent ended, is not said
  // twice as a fact.
  // The id of the call that started a sub-agent is for joining, and says nothing to a reader;
  // whose a note is, is not said again under the sub-agent that made it.
  const facts = Object.entries(event.data).filter(
    ([name, fact]) =>
      fact !== null &&
      name !== "signal" &&
      name !== "kind" &&
      name !== "ended" &&
      name !== "over" &&
      name !== "parent" &&
      !(name === "subagent" && props.inside === true),
  );
  const lines = event.text.split("\n").filter((line) => line.trim().length > 0);
  return (
    <li
      className={cx(
        "sc-talk-item",
        "sc-talk-note",
        "sc-fine",
        event.kind === "error" && "sc-talk-note-error",
      )}
      data-n={event.n}
    >
      <span className="sc-talk-note-line">
        <span className="sc-talk-kind">{kinds[event.kind] ?? event.kind}</span>
        {facts.map(([name, fact]) => (
          <span key={name} className="sc-talk-fact">
            {wordOf(words.facts, name)} {String(fact)}
          </span>
        ))}
        {lines.length === 1 && <span>{lines[0]}</span>}
        {when(event)}
      </span>
      {lines.length > 1 && text(event, "sc-talk-text sc-talk-text-note", props.whole)}
      {pictures(event)}
    </li>
  );
}, sameLine);

/**
 * A session as a conversation: what the agent was told at the right, as whoever said it wrote
 * it, with the files that came with it; what the agent said at the left, beside its picture; its
 * thoughts folded; a tool's call and what it answered as one row that opens, the steps of a turn
 * close together; a sub-agent as one row that opens on what it did; a wake, a status and an
 * error as notes between, and a line where a turn ended, with how long it took. A picture opens
 * large over the page. What the agent said is Markdown rendered to elements; everything else its
 * product printed is text, and nothing of either is ever HTML (ADR-0141). Each line is drawn
 * once and again only when it changed, however long the session is.
 */
export function TranscriptView(props: TranscriptViewProps) {
  const words = useWords().agents.page.live;
  const shown = usePicture();
  // What was read whole belongs to the session it was read in: the events of another carry the
  // same numbers, and a view that goes on to show them must show none of this.
  const [whole, setWhole] = useState<WholeTexts>(NO_WHOLE);
  const [reading, setReading] = useState<
    { readonly of: string | undefined; readonly n: number } | undefined
  >(undefined);
  const of = props.of;
  const showing = useRef(of);
  showing.current = of;
  // What the view is given may be made anew by whoever renders it; the lines are handed the
  // same hands each time, which reach for what was given last.
  const given = useRef(props);
  given.current = props;
  const readWhole = useCallback(
    (n: number) => {
      const load = given.current.onReadWhole;
      if (load === undefined) {
        return;
      }
      setReading({ of, n });
      void load(n)
        .then((text) => {
          // An answer that arrives once another session is shown is that session's no more.
          if (showing.current === of) {
            setWhole((current) => withWhole(current, of, n, text));
          }
        })
        .catch(() => undefined)
        .finally(() =>
          setReading((current) =>
            current !== undefined && current.of === of && current.n === n ? undefined : current,
          ),
        );
    },
    [of],
  );
  const reads = props.onReadWhole !== undefined;
  const hasSignalFiles = props.signalFileHref !== undefined;
  const openPicture = shown.open;
  const hands = useMemo<TalkHands>(
    () => ({
      fileHref: (fileId) => given.current.fileHref(fileId),
      signalFileHref: hasSignalFiles
        ? (number, fileId) => given.current.signalFileHref?.(number, fileId) ?? ""
        : undefined,
      readWhole: reads ? readWhole : undefined,
      openPicture,
    }),
    [hasSignalFiles, reads, readWhole, openPicture],
  );
  const events = props.events;
  const items = useMemo(() => talkOf(events), [events]);
  const began = useMemo(() => turnStarts(events), [events]);
  if (events.length === 0) {
    return (
      <>
        {props.empty ?? null}
        {props.foot !== undefined && props.foot !== null && (
          <ol className="sc-talk" aria-label={words.transcript}>
            {props.foot}
          </ol>
        )}
      </>
    );
  }
  const lines = talkLinesOf({
    items,
    hands,
    agent: props.agent,
    began,
    signalFiles: props.signalFiles,
    whole,
    of,
    reading: reading !== undefined && reading.of === of ? reading.n : undefined,
    today: today(),
    live: props.live,
  });
  return (
    <>
      <ol className="sc-talk" aria-label={words.transcript}>
        {lines.map(({ key, ...line }) => (
          <TalkLine key={key} {...line} />
        ))}
        {props.foot}
      </ol>
      <Lightbox picture={shown.shown} onClose={shown.close} />
    </>
  );
}

export interface TalkWaitingProps {
  /** The words that wait, the oldest first: `waitingOf` says which. */
  readonly signals: readonly RestSignal[];
  /**
   * Why they wait, which says when they are handed over: a turn under way that the product
   * takes a message in (`call`) or takes none in (`turn`), which is also what the account's
   * own reset waits for whatever its product takes in a turn; an agent that is stopped, a
   * runner not heard from, or nothing but the moment it takes to hand them over (`soon`).
   */
  readonly why: "call" | "turn" | "stopped" | "unheard" | "soon";
  /** Where the bytes of a file of a signal are read. */
  readonly fileHref?: ((number: number, fileId: string) => string) | undefined;
  readonly busy?: boolean | undefined;
  /**
   * Stops the turn under way so that what waits is read now. Left out, or with no turn to
   * stop, there is no such way.
   */
  readonly onInterrupt?: (() => void) | undefined;
}

/**
 * What was said and the agent has not taken yet, at the foot of the conversation: each as it
 * will stand there, quieter, with what it was where it was more than a tell and when it is
 * read; and under the last, while a turn is under way, the way to have them read now. Rows of
 * the conversation's list.
 */
export function TalkWaiting(props: TalkWaitingProps) {
  const words = useWords().agents.page.live;
  const waits = words.waiting;
  if (props.signals.length === 0) {
    return null;
  }
  const stops = props.onInterrupt !== undefined && (props.why === "call" || props.why === "turn");
  return (
    <>
      {props.signals.map((signal, index) => {
        const last = index === props.signals.length - 1;
        const pictures = signal.attachments.filter((file) => isPicture(file.contentType));
        const others = signal.attachments.filter((file) => !isPicture(file.contentType));
        return (
          <li
            key={signal.number}
            className="sc-talk-item sc-talk-told sc-talk-waiting"
            data-signal={signal.number}
          >
            <div className="sc-talk-bubble">
              {signal.text.length > 0 && <pre className="sc-talk-text">{signal.text}</pre>}
              {pictures.length > 0 && props.fileHref !== undefined && (
                <ul className="sc-talk-pictures">
                  {pictures.map((file) => (
                    <li key={file.id}>
                      <img
                        src={props.fileHref?.(signal.number, file.id)}
                        alt={file.name}
                        title={`${file.name} · ${formatBytes(file.size)}`}
                        loading="lazy"
                      />
                    </li>
                  ))}
                </ul>
              )}
              {others.length > 0 && (
                <ul className="sc-chosen-files" aria-label={words.files}>
                  {others.map((file) => (
                    <li key={file.id} className="sc-chosen-file">
                      <span>{file.name}</span>{" "}
                      <span className="sc-muted">{formatBytes(file.size)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="sc-talk-meta sc-fine">
              <span className="sc-name">
                {signal.by === null ? words.kinds.person : personName(signal.by)}
              </span>
              {signal.kind !== "tell" && <Badge>{wordOf(words.signalKinds, signal.kind)}</Badge>}
              <Time iso={signal.at} precision="clock" />
            </div>
            {last && (
              <p className="sc-talk-wait sc-fine" role="status">
                <span>{waits[props.why]}</span>
                {stops && (
                  <Button
                    size="sm"
                    disabled={props.busy === true}
                    title={waits.interruptHint}
                    onClick={props.onInterrupt}
                  >
                    {waits.interrupt}
                  </Button>
                )}
              </p>
            )}
          </li>
        );
      })}
    </>
  );
}

/**
 * The sign that the agent is at work while a turn is under way: its picture, three dots, and
 * what it is at, a thought, a tool by its name, or the work between. Where sub-agents run, it
 * says how many, with each under it: its name, what it is at, how many tools it called and how
 * long it has run, which the page counts by itself (ADR-0141). Sub-agents that go on in the
 * background are at work past the turn that started them (ADR-0161), and the sign stands for
 * them alone then. A row of the conversation's list; nothing where no turn is under way and no
 * sub-agent is at work.
 */
export function TalkWorking(props: {
  readonly working: Working | undefined;
  readonly agent?: RestPerson | undefined;
  /** The sub-agents at work in the session: `atWorkOf` says which. */
  readonly agents?: readonly SubAgent[] | undefined;
}) {
  const live = useWords().agents.page.live;
  const words = live.working;
  const { working } = props;
  const agents = props.agents ?? [];
  if (working === undefined && agents.length === 0) {
    return null;
  }
  return (
    <li
      className={cx(
        "sc-talk-item",
        "sc-talk-working",
        "sc-note",
        agents.length > 0 && "sc-talk-working-agents",
      )}
      role="status"
    >
      {props.agent !== undefined && <Avatar person={props.agent} size="sm" />}
      <span className="sc-talk-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span>{agents.length > 0 ? words.agents(agents.length) : workingWord(words, working)}</span>
      {agents.length > 0 && (
        // A clock that ticks is not read out at every second.
        <ul className="sc-talk-agents" aria-live="off">
          {agents.map((one) => (
            <li key={one.n} className="sc-talk-agents-row">
              <span className="sc-name sc-talk-agent-name">
                {one.name.length === 0 ? live.agent.label : one.name}
              </span>
              <span className="sc-talk-agents-facts">
                {workingWord(words, one.at)} · {live.agent.calls(one.calls)} ·{" "}
                <RunningFor since={one.startedAt} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export interface ChatPaneProps {
  /** What the pane is called to a screen reader. */
  readonly label: string;
  /** The conversation: whatever is read in the pane, which scrolls by itself. */
  readonly children: ReactNode;
  /** The box to speak in, at the pane's foot, always in sight. */
  readonly composer?: ReactNode;
  /**
   * Changes when whoever reads said something: the pane goes to its end and follows from
   * there, wherever they had scrolled to.
   */
  readonly said?: number | undefined;
}

/**
 * A conversation in a pane of its own, as a chat is read: it scrolls within the pane, with the
 * box to speak in at its foot. The pane follows the conversation's end while whoever reads is
 * there, leaves them where they are once they scrolled up to read, and then offers the way
 * back to the latest, saying when something arrived meanwhile.
 */
export function ChatPane(props: ChatPaneProps) {
  const words = useWords().agents.page.live;
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const whole = useRef<HTMLElement>(null);
  /** Whether the pane follows its end: true until whoever reads scrolls away from it. */
  const follows = useRef(true);
  /** Until when a scroll is taken for the reader's own: set by what a hand does to the pane. */
  const hand = useRef(0);
  const [away, setAway] = useState(false);
  const [fresh, setFresh] = useState(false);
  const toEnd = () => {
    const pane = scroller.current;
    if (pane !== null) {
      follows.current = true;
      pane.scrollTop = pane.scrollHeight;
      setAway(false);
      setFresh(false);
    }
  };
  // The pane is as tall as the window leaves under what stands over it on the page, so that
  // the box to speak in is in sight without scrolling: where it begins is measured, here and
  // whenever the page is drawn again or the window changes, and the stylesheet takes it from there.
  useEffect(() => {
    const measure = () => {
      const pane = whole.current;
      if (pane !== null) {
        const top = Math.round(pane.getBoundingClientRect().top + window.scrollY);
        pane.style.setProperty("--sc-chat-top", `${top}px`);
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  });
  useEffect(() => {
    const pane = scroller.current;
    const inner = content.current;
    if (pane === null || inner === null) {
      return;
    }
    const now = () => (typeof performance === "undefined" ? Date.now() : performance.now());
    const onHand = () => {
      hand.current = now() + HAND_MS;
    };
    const onScroll = () => {
      const byHand = now() < hand.current;
      const goes = followsAfter(follows.current, byHand, pane);
      follows.current = goes;
      setAway(!goes);
      if (goes) {
        setFresh(false);
        // Moved by itself while it follows: the conversation changed under it, so back to its end.
        if (!byHand && !followsEnd(pane)) {
          pane.scrollTop = pane.scrollHeight;
        }
      } else if (byHand) {
        // A finger let go goes on scrolling for a while: each step of it is still the reader's.
        hand.current = now() + HAND_MS;
      }
    };
    pane.addEventListener("scroll", onScroll, { passive: true });
    const hands = ["wheel", "touchstart", "touchmove", "pointerdown", "keydown"] as const;
    for (const name of hands) {
      pane.addEventListener(name, onHand, { passive: true });
    }
    // What arrives, and a picture that loads late, change how tall the conversation is: the
    // pane goes with it while it is followed, and says that there is more where it is not.
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(() => {
            if (follows.current) {
              pane.scrollTop = pane.scrollHeight;
            } else {
              setFresh(true);
            }
          });
    observer?.observe(inner);
    pane.scrollTop = pane.scrollHeight;
    return () => {
      pane.removeEventListener("scroll", onScroll);
      for (const name of hands) {
        pane.removeEventListener(name, onHand);
      }
      observer?.disconnect();
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `said` is the trigger
  useEffect(() => {
    if (props.said !== undefined && props.said > 0) {
      toEnd();
    }
  }, [props.said]);
  return (
    <section className="sc-panel sc-chat" aria-label={props.label} ref={whole}>
      <div className="sc-chat-scroll" ref={scroller}>
        <div className="sc-chat-content" ref={content}>
          {props.children}
        </div>
      </div>
      {away && (
        <div className="sc-chat-latest">
          <Button size="sm" onClick={toEnd}>
            {fresh ? words.latestNew : words.latest}
          </Button>
        </div>
      )}
      {props.composer !== undefined && props.composer !== null && (
        <div className="sc-chat-foot">{props.composer}</div>
      )}
    </section>
  );
}

/**
 * The files of a tell with the ones just chosen added: a file that is there already is not
 * added again, so that nothing is sent twice.
 */
export function withChosen(current: readonly File[], chosen: readonly File[]): readonly File[] {
  const same = (one: File, other: File): boolean =>
    one.name === other.name && one.size === other.size && one.lastModified === other.lastModified;
  const added: File[] = [];
  for (const file of chosen) {
    if (![...current, ...added].some((one) => same(one, file))) {
      added.push(file);
    }
  }
  return [...current, ...added];
}

/** The files of a tell without the one at a place: what the way out of its chip leaves. */
export function withoutChosen(current: readonly File[], at: number): readonly File[] {
  return current.filter((_, index) => index !== at);
}

/**
 * Whether a key pressed in the box tells what is written: Enter alone, as the boxes of agent
 * products have it, with Shift for a new line; and never while a word is still being composed,
 * as Korean is, where Enter ends the composing and not the message.
 */
export function tellsWith(event: {
  readonly key: string;
  readonly shiftKey?: boolean;
  readonly isComposing?: boolean;
  readonly keyCode?: number;
}): boolean {
  // 229 is what a browser says of a key pressed while composing, where it says nothing else.
  return (
    event.key === "Enter" &&
    event.shiftKey !== true &&
    event.isComposing !== true &&
    event.keyCode !== 229
  );
}

/** A picture pasted from a clipboard is called `image.png` by every browser: a name of its own, by the moment. */
export function pastedName(file: File, at: Date): string {
  if (file.name !== "image.png" && file.name.length > 0) {
    return file.name;
  }
  const two = (value: number): string => String(value).padStart(2, "0");
  const stamp = `${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}-${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}`;
  const ending = file.type === "image/jpeg" ? "jpg" : (file.type.split("/")[1] ?? "png");
  return `pasted-${stamp}.${ending}`;
}

/**
 * Whether what was told was taken, by what whoever tells answered: `false`, or a request that
 * failed, says it was not, and the box keeps what was written; anything else, nothing among it,
 * says it was, so that a handler that answers nothing is taken at its word.
 */
export async function takenBy(answer: unknown): Promise<boolean> {
  try {
    return (await answer) !== false;
  } catch {
    return false;
  }
}

/**
 * What stands in the box once what was sent from it was taken: nothing, or what was written
 * after it while the console was asked; words changed meanwhile are another message, and stay.
 */
export function afterTold(current: string, sent: string): string {
  return current.startsWith(sent) ? current.slice(sent.length).trimStart() : current;
}

/** How tall the box grows with what is written in it, before it scrolls. */
const MAX_BOX_PIXELS = 280;

/** A picture is shown small beside its name where it is no larger than this: a larger one is named alone. */
const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;

export interface SignalComposerProps {
  /** How the agent stands: a stopped agent is told nothing until it is started again, and the box says so. */
  readonly state: AgentState | undefined;
  /**
   * Whether the agent's product takes a picture (`offers.images`): where it takes none, a
   * picture is handed over as a file in its desk, and the box says so before it is sent.
   */
  readonly images?: boolean | undefined;
  readonly busy?: boolean | undefined;
  /** What went wrong with what was sent last, as a line under the box. */
  readonly note?: ReactNode;
  /**
   * Tells the agent what was written, with the files chosen. Where it answers whether the tell
   * was taken, itself or as a promise, `false` or a failure keeps the words and the files in the
   * box, to be sent again, and the box is emptied only once the tell was taken; where it answers
   * nothing, the box is emptied as it is sent.
   */
  readonly onSend: (text: string, files: readonly FileUpload[]) => unknown;
}

/**
 * What a supervisor says to the agent, as the box of a chat is: one box with the words, the
 * files chosen, pasted or dropped on it above them, a picture shown small and any other file by
 * its name, each taken out again from its chip, and under the words the way to choose files and
 * the way to send. Enter tells; Shift with Enter is a new line. What is told stands in the
 * conversation at once, as waiting until the agent takes it, and the way to have it read now is
 * there, beside it: the box has none. What changes how the agent stands, a stop, a restart, a
 * reset, is not said here: `AgentControls` has it.
 */
export function SignalComposer(props: SignalComposerProps) {
  const words = useWords().agents.page.tell;
  const [text, setText] = useState("");
  const [files, setFiles] = useState<readonly File[]>([]);
  const [previews, setPreviews] = useState<Readonly<Record<string, string>>>({});
  const [over, setOver] = useState(false);
  /** Whether a tell is on its way: nothing more is sent until the console answered. */
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  // The box grows with what is written in it, lines that wrap among them, up to a bound.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `text` is the trigger
  useEffect(() => {
    const area = box.current;
    if (area !== null) {
      area.style.height = "auto";
      area.style.height = `${Math.min(area.scrollHeight + 2, MAX_BOX_PIXELS)}px`;
    }
  }, [text]);
  const said = text.trim();
  const busy = props.busy === true;
  const tooMany = files.length > MAX_SIGNAL_ATTACHMENTS;
  const tooLarge = files.reduce((total, file) => total + file.size, 0) > MAX_FILE_BYTES;
  const keyOf = (file: File): string => `${file.name}-${file.size}-${file.lastModified}`;
  const add = (chosen: readonly File[]) => {
    if (chosen.length === 0) {
      return;
    }
    setFiles((current) => withChosen(current, chosen));
    // A picture is read here to be shown small: the page's policy takes a picture as data.
    for (const file of chosen) {
      if (
        isPicture(file.type) &&
        file.size <= MAX_PREVIEW_BYTES &&
        typeof FileReader !== "undefined"
      ) {
        const reader = new FileReader();
        reader.onload = () => {
          const read = reader.result;
          if (typeof read === "string") {
            setPreviews((current) => ({ ...current, [keyOf(file)]: read }));
          }
        };
        reader.readAsDataURL(file);
      }
    }
  };
  const send = () => {
    const written = text;
    const sent = files;
    const answer = props.onSend(
      said,
      sent.map((file) => ({ name: file.name, bytes: file, contentType: file.type })),
    );
    setSending(true);
    // What was written stays until the console took it: a refusal, or a request that failed,
    // leaves the words and the files where they are, with what went wrong said under them.
    void takenBy(answer).then((taken) => {
      setSending(false);
      if (!taken) {
        return;
      }
      setText((current) => afterTold(current, written));
      setFiles((current) => current.filter((file) => !sent.includes(file)));
      setPreviews((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([key]) => !sent.some((file) => keyOf(file) === key)),
        ),
      );
    });
  };
  const ready = said.length > 0 && !tooMany && !tooLarge && !busy && !sending;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready) {
      send();
    }
  };
  const stopped = props.state === "stopped";
  const unseen = props.images === false && files.some((file) => isPicture(file.type));
  return (
    <form
      className={cx("sc-signal-composer", over && "sc-signal-composer-over")}
      aria-label={words.aria}
      onSubmit={submit}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        if (event.dataTransfer.files.length > 0) {
          event.preventDefault();
          add([...event.dataTransfer.files]);
        }
        setOver(false);
      }}
    >
      <div className="sc-signal-box">
        {files.length > 0 && (
          <ul className="sc-chosen-files sc-signal-files" aria-label={words.files}>
            {files.map((file, index) => {
              const preview = previews[keyOf(file)];
              return (
                <li key={keyOf(file)} className="sc-chosen-file">
                  {preview !== undefined && (
                    <img className="sc-signal-thumb" src={preview} alt="" />
                  )}
                  <span className="sc-signal-file-name">{file.name}</span>{" "}
                  <span className="sc-muted">{formatBytes(file.size)}</span>{" "}
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={words.removeFile(file.name)}
                    onClick={() => setFiles((current) => withoutChosen(current, index))}
                  >
                    ×
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <textarea
          ref={box}
          className="sc-signal-text"
          aria-label={words.placeholder}
          placeholder={stopped ? words.placeholderStopped : words.placeholder}
          value={text}
          maxLength={MAX_SIGNAL_LENGTH}
          rows={1}
          onChange={(event) => setText(event.target.value)}
          onPaste={(event) => {
            const pasted = [...event.clipboardData.files];
            if (pasted.length > 0) {
              event.preventDefault();
              const now = new Date();
              add(
                pasted.map((file) => new File([file], pastedName(file, now), { type: file.type })),
              );
            }
          }}
          onKeyDown={(event) => {
            // On a screen that is touched, Enter is the keyboard's new line: the button tells.
            if (
              typeof window !== "undefined" &&
              window.matchMedia?.("(pointer: coarse)").matches === true
            ) {
              return;
            }
            if (
              tellsWith({
                key: event.key,
                shiftKey: event.shiftKey,
                isComposing: event.nativeEvent.isComposing,
                keyCode: event.keyCode,
              })
            ) {
              event.preventDefault();
              if (ready) {
                send();
              }
            }
          }}
        />
        <div className="sc-signal-row">
          <label className="sc-button sc-button-ghost sc-button-sm sc-file-choice">
            {words.attach}
            <input
              className="sc-file-input"
              type="file"
              multiple
              onChange={(event) => {
                add([...(event.target.files ?? [])]);
                // The box is emptied, so that a file taken out can be chosen again.
                event.target.value = "";
              }}
            />
          </label>
          <Button type="submit" variant="primary" size="sm" disabled={!ready}>
            {words.send}
          </Button>
        </div>
      </div>
      {tooMany && (
        <p className="sc-form-error" role="alert">
          {words.tooMany(MAX_SIGNAL_ATTACHMENTS)}
        </p>
      )}
      {tooLarge && (
        <p className="sc-form-error" role="alert">
          {words.tooLarge(formatBytes(MAX_FILE_BYTES))}
        </p>
      )}
      {files.length > 0 && said.length === 0 && <p className="sc-field-hint">{words.needsWords}</p>}
      {unseen && <p className="sc-field-hint">{words.unseen}</p>}
      {props.note !== undefined && <p className="sc-field-hint">{props.note}</p>}
    </form>
  );
}

export interface AgentControlsProps {
  /** How the agent stands, by which what is offered is chosen: a running agent is stopped, one that is not is started again. */
  readonly state: AgentState | undefined;
  readonly busy?: boolean | undefined;
  /**
   * Sends a stop, a restart or a reset, with the words for the agent where any were written.
   * What it answers says whether the signal was taken, as the box to speak in is answered:
   * `false`, or a request that failed, leaves the words where they are.
   */
  readonly onSend: (kind: "stop" | "restart" | "reset", text: string) => unknown;
  /** What was sent last, as a line under the ways. */
  readonly note?: ReactNode;
}

/**
 * What changes how the agent stands, apart from what is said to it: a stop, which holds until
 * it is started again; a restart, which goes on with the same conversation; a reset, which
 * begins a new one and is asked twice. Each with words for the agent, where its supervisor has
 * any, and with what it does said under it.
 */
export function AgentControls(props: AgentControlsProps) {
  const words = useWords().agents.page.tell;
  const [text, setText] = useState("");
  const [resetting, setResetting] = useState(false);
  const busy = props.busy === true;
  const send = (kind: "stop" | "restart" | "reset") => {
    const answer = props.onSend(kind, text.trim());
    setResetting(false);
    // The words stay until the console took the signal, as what is told does.
    void takenBy(answer).then((taken) => {
      if (taken) {
        setText("");
      }
    });
  };
  const running = props.state === "running";
  const stopped = props.state === "stopped";
  return (
    <div className="sc-agent-controls">
      <label className="sc-field">
        <span className="sc-field-label">{words.controlWords}</span>
        <input
          className="sc-input"
          value={text}
          maxLength={MAX_SIGNAL_LENGTH}
          placeholder={words.controlWordsPlaceholder}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <div className="sc-agent-controls-ways">
        {!running && (
          <Button size="sm" disabled={busy} onClick={() => send("restart")}>
            {words.restart}
          </Button>
        )}
        {!stopped && (
          <Button size="sm" disabled={busy} onClick={() => send("stop")}>
            {words.stop}
          </Button>
        )}
        {resetting ? (
          <>
            <Button variant="danger" size="sm" disabled={busy} onClick={() => send("reset")}>
              {words.resetConfirm}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setResetting(false)}>
              {words.cancel}
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setResetting(true)}>
            {words.reset}
          </Button>
        )}
      </div>
      {props.note !== undefined && props.note !== null && (
        <p className="sc-field-hint" role="status">
          {props.note}
        </p>
      )}
      {resetting ? (
        <Callout tone="warning">{words.resetWarning}</Callout>
      ) : (
        <ul className="sc-agent-controls-says">
          {!running && (
            <li>
              <b>{words.restart}</b> {words.restartHint}
            </li>
          )}
          {!stopped && (
            <li>
              <b>{words.stop}</b> {words.stopHint}
            </li>
          )}
          <li>
            <b>{words.reset}</b> {words.resetHint}
          </li>
        </ul>
      )}
    </div>
  );
}

export interface AgentChoiceProps {
  readonly runner: RestAgentRunner | null | undefined;
  readonly busy?: boolean | undefined;
  /** Sets what is named; `null` for the product's own again. */
  readonly onSet: (choice: { model?: string | null; effort?: string | null }) => void;
}

/** The model and the level of effort an agent runs with, chosen from what its product offers. */
export function AgentChoice(props: AgentChoiceProps) {
  const words = useWords().agents.page.choice;
  const runner = props.runner ?? null;
  const offers = runner?.offers ?? null;
  if (
    runner === null ||
    offers === null ||
    (offers.models.length === 0 && offers.efforts.length === 0)
  ) {
    return <p className="sc-field-hint">{words.none}</p>;
  }
  const select = (
    label: string,
    name: "model" | "effort",
    offered: readonly string[],
    chosen: string | null,
  ) =>
    offered.length === 0 ? null : (
      <label className="sc-field sc-agent-choice-field">
        <span className="sc-field-label">{label}</span>
        <select
          className="sc-input"
          value={chosen ?? ""}
          disabled={props.busy === true}
          onChange={(event) =>
            props.onSet({ [name]: event.target.value === "" ? null : event.target.value })
          }
        >
          <option value="">{words.own}</option>
          {/* What is chosen stays choosable when the product offers it no more. */}
          {[...new Set([...offered, ...(chosen === null ? [] : [chosen])])].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
    );
  const running = runner.running;
  return (
    <div className="sc-agent-choice">
      {select(words.model, "model", offers.models, runner.settings.model)}
      {select(words.effort, "effort", offers.efforts, runner.settings.effort)}
      {running !== null && (running.model !== null || running.effort !== null) && (
        <p className="sc-field-hint">
          {words.runsWith(running.model ?? words.own, running.effort ?? words.own)}
        </p>
      )}
    </div>
  );
}

export interface AgentSessionListProps {
  readonly sessions: readonly RestAgentSession[];
  readonly href: (session: RestAgentSession) => string;
  readonly empty?: ReactNode;
}

/**
 * An agent account's sessions, the newest first, a row each that leads to it: when it began and
 * ended, how it ended, what it ran and where, and how much it holds.
 */
export function AgentSessionList(props: AgentSessionListProps) {
  const words = useWords().agents.page.sessions;
  if (props.sessions.length === 0) {
    return <>{props.empty ?? null}</>;
  }
  const ends: Readonly<Record<string, string>> = words.ends;
  return (
    <ul className="sc-agent-sessions" aria-label={words.title}>
      {props.sessions.map((session) => (
        <li key={session.id} className="sc-agent-session">
          <span className="sc-agent-session-when">
            <a className="sc-agent-session-link" href={props.href(session)}>
              <Time iso={session.startedAt} />
            </a>
            {session.endedAt !== null && (
              <span className="sc-agent-session-until">
                {" – "}
                <Time iso={session.endedAt} precision="clock" against={session.startedAt} />
              </span>
            )}
          </span>
          <span className="sc-agent-session-badges">
            {session.ended === null ? (
              <Badge tone="success" kind="state">
                {words.open}
              </Badge>
            ) : (
              <Badge tone={session.ended === "crashed" ? "danger" : "neutral"}>
                {ends[session.ended] ?? session.ended}
              </Badge>
            )}
            {session.away && <Badge tone="warning">{words.away}</Badge>}
          </span>
          <span className="sc-agent-session-facts sc-note">
            {[
              `${session.product.name}${session.product.version === null ? "" : ` ${session.product.version}`}`,
              ...(session.model === null ? [] : [session.model]),
              ...(session.resumed ? [words.resumed] : []),
              session.machine.name,
            ].join(" · ")}
          </span>
          <span className="sc-agent-session-count">{words.events(session.events)}</span>
        </li>
      ))}
    </ul>
  );
}

/** What an agent's runner last said of itself: where it runs, with what, and where its record stands. */
export function AgentRunnerFacts(props: { readonly runner: RestAgentRunner | null | undefined }) {
  const words = useWords().agents.page.settings.runner;
  const runner = props.runner ?? null;
  if (runner === null || (runner.machine === null && runner.product === null)) {
    return <p className="sc-field-hint">{words.none}</p>;
  }
  const facts: [string, ReactNode][] = [
    ...(runner.machine === null
      ? []
      : ([
          [words.machine, `${runner.machine.name} · ${runner.machine.os}`],
          [words.user, runner.machine.user],
        ] as [string, ReactNode][])),
    ...(runner.runner === null ? [] : ([[words.version, runner.runner]] as [string, ReactNode][])),
    ...(runner.product === null
      ? []
      : ([
          [
            words.product,
            <span key="product" className="sc-agent-product">
              {runner.product.name}
              {runner.product.version !== null && ` ${runner.product.version}`}
              {!runner.product.tried && <Badge tone="warning">{words.untried}</Badge>}
            </span>,
          ],
        ] as [string, ReactNode][])),
    [words.signals, words.delivered(runner.delivered, runner.latest)],
    // The wake sources its runner keeps beside the console's own, as it last said (ADR-0144):
    // each by its module's name, with how it stands and why where it does not listen.
    ...(runner.sources === undefined || runner.sources.length === 0
      ? []
      : ([
          [
            words.sources,
            <span key="sources" className="sc-agent-product">
              {runner.sources.map((source) => (
                <span key={source.name} className="sc-agent-product">
                  {source.name}
                  <Badge
                    tone={
                      source.state === "connected"
                        ? "success"
                        : source.state === "failing"
                          ? "danger"
                          : "warning"
                    }
                  >
                    {wordOf(words.sourceStates, source.state)}
                  </Badge>
                  {source.why !== undefined && <span className="sc-muted">{source.why}</span>}
                </span>
              ))}
            </span>,
          ],
        ] as [string, ReactNode][])),
  ];
  return (
    <dl className="sc-person-facts sc-agent-runner-facts">
      {facts.map(([name, value]) => (
        <div key={name} className="sc-person-fact">
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The accounts an agent account holds elsewhere (ADR-0089): what it is called at each service,
 * as it or a supervisor recorded them, and no secret. What to close when the account is taken out.
 */
export function AgentElsewhereList(props: {
  readonly accounts: Readonly<Record<string, string>> | undefined;
}) {
  const words = useWords().agents.page.settings.elsewhere;
  const held = Object.entries(props.accounts ?? {});
  return (
    <div>
      {held.length === 0 ? (
        <p className="sc-field-hint">{words.empty}</p>
      ) : (
        <dl className="sc-person-facts sc-agent-runner-facts" aria-label={words.title}>
          {held.map(([service, name]) => (
            <div key={service} className="sc-person-fact">
              <dt>{service}</dt>
              <dd>{name}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="sc-field-hint">{words.intro}</p>
    </div>
  );
}

export interface AgentSecretListProps {
  readonly secrets: readonly RestAgentSecret[];
  readonly busy?: boolean | undefined;
  /** Seeds a secret, write-only: only the account reads the value back. */
  readonly onSeed: (name: string, value: string) => void;
  readonly onRemove: (name: string) => void;
}

/** The names of an agent account's secrets, and the way a supervisor seeds one or removes one. Never a value. */
export function AgentSecretList(props: AgentSecretListProps) {
  const words = useWords().agents.page.settings.secrets;
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const busy = props.busy === true;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().length === 0 || value.length === 0 || busy) {
      return;
    }
    props.onSeed(name.trim(), value);
    setName("");
    setValue("");
  };
  return (
    <div>
      {props.secrets.length === 0 ? (
        <p className="sc-field-hint">{words.empty}</p>
      ) : (
        <ul className="sc-divided sc-agent-secret-list" aria-label={words.title}>
          {props.secrets.map((secret) => (
            <li key={secret.name} className="sc-small sc-agent-secret">
              <code>{secret.name}</code>
              <span className="sc-muted">
                <Time iso={secret.setAt} precision="day" />
                {secret.seeded && ` · ${words.seeded}`}
                {secret.expiresOn !== null && ` · ${words.expires(secret.expiresOn)}`}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => props.onRemove(secret.name)}
              >
                {words.remove}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form className="sc-agent-secret-form" aria-label={words.seedAria} onSubmit={submit}>
        <input
          className="sc-input"
          aria-label={words.name}
          placeholder={words.namePlaceholder}
          value={name}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className="sc-input"
          type="password"
          aria-label={words.value}
          placeholder={words.value}
          value={value}
          autoComplete="new-password"
          onChange={(event) => setValue(event.target.value)}
        />
        <Button type="submit" disabled={busy || name.trim().length === 0 || value.length === 0}>
          {words.seed}
        </Button>
      </form>
      <p className="sc-field-hint">{words.intro}</p>
    </div>
  );
}
