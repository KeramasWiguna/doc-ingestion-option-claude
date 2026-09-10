"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AttachmentMode, ChatSession } from "@/lib/types";

const STORAGE_KEY = "claude-file-api-demo-v2";

const MODE_ORDER: AttachmentMode[] = ["files-api", "self-hosted", "base64"];
const MODE_LABEL: Record<AttachmentMode, string> = {
  "files-api": "Claude Files API",
  "self-hosted": "Self-hosted URL",
  base64: "Inline base64",
};
// Matches --series-1/2/3 in globals.css — same mode -> color mapping on
// every chart on this page (and the mode badge in Chat.tsx).
const MODE_COLOR: Record<AttachmentMode, string> = {
  "files-api": "var(--series-1)",
  "self-hosted": "var(--series-2)",
  base64: "var(--series-3)",
};

type ModeTotals = {
  mode: AttachmentMode;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  attachedBytes: number;
};

type CumulativePoint = {
  turn: number;
  [sessionLabel: string]: number;
};

function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as { sessions?: ChatSession[] }) : null;
    return parsed?.sessions ?? [];
  } catch {
    return [];
  }
}

function computeModeTotals(sessions: ChatSession[]): ModeTotals[] {
  return MODE_ORDER.map((mode) => {
    const modeSessions = sessions.filter((s) => s.mode === mode);
    let turns = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let attachedBytes = 0;
    for (const s of modeSessions) {
      for (const m of s.messages) {
        if (m.usage) {
          turns += 1;
          inputTokens += m.usage.inputTokens;
          outputTokens += m.usage.outputTokens;
        }
        for (const a of m.attachments ?? []) attachedBytes += a.sizeBytes;
      }
    }
    return {
      mode,
      turns,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      attachedBytes,
    };
  });
}

function computeCumulativeSeries(sessions: ChatSession[]) {
  const withTurns = sessions.filter((s) =>
    s.messages.some((m) => m.usage),
  );
  const maxTurns = Math.max(
    0,
    ...withTurns.map((s) => s.messages.filter((m) => m.usage).length),
  );
  const points: CumulativePoint[] = [];
  for (let turn = 1; turn <= maxTurns; turn++) {
    const point: CumulativePoint = { turn };
    for (const s of withTurns) {
      const usageMessages = s.messages.filter((m) => m.usage);
      const upTo = usageMessages.slice(0, turn);
      if (upTo.length === 0) continue;
      point[s.id] = upTo.reduce(
        (sum, m) => sum + (m.usage!.inputTokens + m.usage!.outputTokens),
        0,
      );
    }
    points.push(point);
  }
  return { points, sessions: withTurns };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export default function BenchmarkApp() {
  const [sessions, setSessions] = useState<ChatSession[]>(loadSessions);
  // Sessions default to visible; only ids explicitly toggled off land here.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setSessions(loadSessions());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggleSession = (id: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const visibleSessions = sessions.filter((s) => !hiddenIds.has(s.id));
  const totals = computeModeTotals(visibleSessions);
  const { points, sessions: linedSessions } = computeCumulativeSeries(visibleSessions);
  // Whether any session ever recorded a turn, regardless of visibility toggles —
  // controls whether the empty-state placeholder replaces the whole page.
  const hasAnyTurns = computeModeTotals(sessions).some((t) => t.turns > 0);
  const hasAnyVisibleTurns = totals.some((t) => t.turns > 0);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Token usage benchmark</h1>
          <p className="text-sm text-zinc-500">
            Compares input/output tokens per turn across the three attachment
            modes. Refreshes from this browser&apos;s local sessions.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSessions(loadSessions())}
          className="h-9 shrink-0 rounded-full border border-black/[.08] px-4 text-sm font-medium hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-white/[.08]"
        >
          Refresh
        </button>
      </div>

      {!hasAnyTurns ? (
        <p className="rounded-xl border border-black/[.08] p-6 text-center text-sm text-zinc-400 dark:border-white/[.145]">
          No turns with recorded usage yet. Send at least one message in each
          mode&apos;s session, then come back here.
        </p>
      ) : (
        <>
          {!hasAnyVisibleTurns && (
            <p className="mb-8 rounded-xl border border-black/[.08] p-6 text-center text-sm text-zinc-400 dark:border-white/[.145]">
              No sessions selected. Check a session below to show it here.
            </p>
          )}

          {hasAnyVisibleTurns && (
          <>
          <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {totals.map((t) => (
              <div
                key={t.mode}
                className="rounded-xl border border-black/[.08] p-4 dark:border-white/[.145]"
                style={{ borderLeft: `3px solid ${MODE_COLOR[t.mode]}` }}
              >
                <p className="text-xs font-medium text-zinc-500">
                  {MODE_LABEL[t.mode]}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {t.totalTokens.toLocaleString()}
                </p>
                <p className="text-xs text-zinc-400">total tokens</p>
                <p className="mt-2 text-xs text-zinc-500">
                  {t.inputTokens.toLocaleString()} in /{" "}
                  {t.outputTokens.toLocaleString()} out ·{" "}
                  {t.turns} turn{t.turns === 1 ? "" : "s"}
                </p>
                <p className="text-xs text-zinc-400">
                  {formatBytes(t.attachedBytes)} attached
                </p>
              </div>
            ))}
          </div>

          <section className="mb-10">
            <h2 className="mb-3 text-sm font-medium text-zinc-500">
              Total tokens by mode, split input vs. output
            </h2>
            <div className="h-72 w-full rounded-xl border border-black/[.08] p-2 dark:border-white/[.145]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={totals} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid
                    vertical={false}
                    stroke="var(--chart-grid)"
                  />
                  <XAxis
                    dataKey="mode"
                    tickFormatter={(m: AttachmentMode) => MODE_LABEL[m]}
                    tick={{ fill: "var(--chart-ink-muted)", fontSize: 12 }}
                    axisLine={{ stroke: "var(--chart-axis)" }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "var(--chart-ink-muted)", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--chart-surface)",
                      border: "1px solid var(--chart-grid)",
                      borderRadius: 8,
                      fontSize: 12,
                      color: "var(--chart-ink-primary)",
                    }}
                    formatter={(value) => Number(value).toLocaleString()}
                    labelFormatter={(m) => MODE_LABEL[m as AttachmentMode] ?? m}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    dataKey="inputTokens"
                    name="Input tokens"
                    stackId="tokens"
                    fill="var(--series-1)"
                    radius={[0, 0, 4, 4]}
                  />
                  <Bar
                    dataKey="outputTokens"
                    name="Output tokens"
                    stackId="tokens"
                    fill="var(--chart-axis)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
          </>
          )}

          {hasAnyVisibleTurns && points.length > 0 && (
            <section className="mb-10">
              <h2 className="mb-3 text-sm font-medium text-zinc-500">
                Cumulative tokens over conversation turns, by session
              </h2>
              <div className="h-72 w-full rounded-xl border border-black/[.08] p-2 dark:border-white/[.145]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={points} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                    <XAxis
                      dataKey="turn"
                      tick={{ fill: "var(--chart-ink-muted)", fontSize: 12 }}
                      axisLine={{ stroke: "var(--chart-axis)" }}
                      tickLine={false}
                      label={{
                        value: "Turn",
                        position: "insideBottom",
                        offset: -2,
                        fill: "var(--chart-ink-muted)",
                        fontSize: 12,
                      }}
                    />
                    <YAxis
                      tick={{ fill: "var(--chart-ink-muted)", fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                      width={48}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--chart-surface)",
                        border: "1px solid var(--chart-grid)",
                        borderRadius: 8,
                        fontSize: 12,
                        color: "var(--chart-ink-primary)",
                      }}
                      formatter={(value) => Number(value).toLocaleString()}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {linedSessions.map((s) => (
                      <Line
                        key={s.id}
                        dataKey={s.id}
                        name={`${s.title} (${MODE_LABEL[s.mode]})`}
                        stroke={MODE_COLOR[s.mode]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-zinc-500">
                All sessions
              </h2>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setHiddenIds(new Set())}
                  className="text-zinc-500 hover:underline"
                >
                  Show all
                </button>
                <button
                  type="button"
                  onClick={() => setHiddenIds(new Set(sessions.map((s) => s.id)))}
                  className="text-zinc-500 hover:underline"
                >
                  Hide all
                </button>
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-black/[.08] dark:border-white/[.145]">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-black/[.08] text-xs text-zinc-500 dark:border-white/[.145]">
                    <th className="px-3 py-2 font-medium">Show</th>
                    <th className="px-3 py-2 font-medium">Session</th>
                    <th className="px-3 py-2 font-medium">Mode</th>
                    <th className="px-3 py-2 font-medium">Turns</th>
                    <th className="px-3 py-2 font-medium">Input tokens</th>
                    <th className="px-3 py-2 font-medium">Output tokens</th>
                    <th className="px-3 py-2 font-medium">Avg / turn</th>
                    <th className="px-3 py-2 font-medium">Attached</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => {
                    const usageMessages = s.messages.filter((m) => m.usage);
                    const inputTokens = usageMessages.reduce(
                      (sum, m) => sum + m.usage!.inputTokens,
                      0,
                    );
                    const outputTokens = usageMessages.reduce(
                      (sum, m) => sum + m.usage!.outputTokens,
                      0,
                    );
                    const attachedBytes = s.messages
                      .flatMap((m) => m.attachments ?? [])
                      .reduce((sum, a) => sum + a.sizeBytes, 0);
                    const turns = usageMessages.length;
                    const hidden = hiddenIds.has(s.id);
                    return (
                      <tr
                        key={s.id}
                        className={`border-b border-black/[.04] last:border-0 dark:border-white/[.08]${
                          hidden ? " opacity-40" : ""
                        }`}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={!hidden}
                            onChange={() => toggleSession(s.id)}
                            aria-label={`Show ${s.title}`}
                          />
                        </td>
                        <td className="px-3 py-2">{s.title}</td>
                        <td className="px-3 py-2">
                          <span
                            className="inline-block h-2 w-2 rounded-full align-middle"
                            style={{ background: MODE_COLOR[s.mode] }}
                          />{" "}
                          {MODE_LABEL[s.mode]}
                        </td>
                        <td className="px-3 py-2 tabular-nums">{turns}</td>
                        <td className="px-3 py-2 tabular-nums">
                          {inputTokens.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {outputTokens.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {turns > 0
                            ? Math.round(
                                (inputTokens + outputTokens) / turns,
                              ).toLocaleString()
                            : "—"}
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {formatBytes(attachedBytes)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
