import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type UsageTotals = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
};

type AssistantTiming = {
	requestStartMs: number;
	firstOutputMs?: number;
	endMs?: number;
};

type RoundStats = {
	startedAtMs: number;
	timings: AssistantTiming[];
	activeTiming?: AssistantTiming;
};

const WIDGET_KEY = "conversation-metrics";

function emptyUsage(): UsageTotals {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
}

function addUsage(total: UsageTotals, usage: any): void {
	if (!usage) return;
	const input = Number(usage.input ?? 0);
	const output = Number(usage.output ?? 0);
	const cacheRead = Number(usage.cacheRead ?? 0);
	const cacheWrite = Number(usage.cacheWrite ?? 0);
	const totalTokens = Number(usage.totalTokens ?? input + output + cacheRead + cacheWrite);

	total.input += Number.isFinite(input) ? input : 0;
	total.output += Number.isFinite(output) ? output : 0;
	total.cacheRead += Number.isFinite(cacheRead) ? cacheRead : 0;
	total.cacheWrite += Number.isFinite(cacheWrite) ? cacheWrite : 0;
	total.totalTokens += Number.isFinite(totalTokens) ? totalTokens : 0;
}

function formatTokens(value: number): string {
	if (!Number.isFinite(value)) return "0";
	const sign = value < 0 ? "-" : "";
	const n = Math.abs(value);
	if (n < 1_000) return `${sign}${Math.round(n).toLocaleString()}`;
	if (n < 10_000) return `${sign}${(n / 1_000).toFixed(1)}k`;
	if (n < 1_000_000) return `${sign}${Math.round(n / 1_000)}k`;
	if (n < 10_000_000) return `${sign}${(n / 1_000_000).toFixed(1)}M`;
	return `${sign}${Math.round(n / 1_000_000)}M`;
}

function formatPercent(value: number | undefined): string {
	if (value === undefined || !Number.isFinite(value)) return "n/a";
	return `${value.toFixed(1)}%`;
}

function formatSeconds(ms: number | undefined): string {
	if (ms === undefined || !Number.isFinite(ms)) return "n/a";
	if (ms < 1_000) return `${Math.max(0, Math.round(ms))}ms`;
	return `${(ms / 1_000).toFixed(2)}s`;
}

function formatTps(value: number | undefined): string {
	if (value === undefined || !Number.isFinite(value)) return "n/a";
	return `${value.toFixed(1)} tok/s`;
}

function isAssistantMessage(message: any): boolean {
	return message?.role === "assistant";
}

function isFirstOutputEvent(streamEvent: any): boolean {
	if (!streamEvent || typeof streamEvent.type !== "string") return false;

	// Prefer real deltas. For tool-only turns, toolcall_delta/toolcall_end are the
	// first model output events we can observe.
	if (streamEvent.type === "text_delta" || streamEvent.type === "thinking_delta" || streamEvent.type === "toolcall_delta") {
		return typeof streamEvent.delta !== "string" || streamEvent.delta.length > 0;
	}
	return streamEvent.type === "toolcall_end" || streamEvent.type === "done" || streamEvent.type === "error";
}

function summarizeTimings(timings: AssistantTiming[], outputTokens: number): { avgFirstOutputMs?: number; tokensPerSecond?: number } {
	const firstOutputLatencies = timings
		.filter((timing) => timing.firstOutputMs !== undefined)
		.map((timing) => Math.max(0, (timing.firstOutputMs as number) - timing.requestStartMs));

	const avgFirstOutputMs =
		firstOutputLatencies.length > 0
			? firstOutputLatencies.reduce((sum, value) => sum + value, 0) / firstOutputLatencies.length
			: undefined;

	const streamingMs = timings.reduce((sum, timing) => {
		if (timing.endMs === undefined) return sum;
		const start = timing.firstOutputMs ?? timing.requestStartMs;
		return sum + Math.max(0, timing.endMs - start);
	}, 0);

	const tokensPerSecond = streamingMs > 0 && outputTokens > 0 ? outputTokens / (streamingMs / 1_000) : undefined;
	return { avgFirstOutputMs, tokensPerSecond };
}

function buildSummary(usage: UsageTotals, timings: AssistantTiming[]): string {
	const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
	const cacheHitRate = promptTokens > 0 ? (usage.cacheRead / promptTokens) * 100 : undefined;
	const timingSummary = summarizeTimings(timings, usage.output);

	return [
		`INPUT ${formatTokens(usage.input)}`,
		`OUTPUT ${formatTokens(usage.output)}`,
		`TOKEN ${formatTokens(usage.totalTokens)}`,
		`CACHE ${formatPercent(cacheHitRate)}`,
		`TTFT(avg) ${formatSeconds(timingSummary.avgFirstOutputMs)}`,
		`TPS ${formatTps(timingSummary.tokensPerSecond)}`,
		`R ${formatTokens(usage.cacheRead)}`,
		`W ${formatTokens(usage.cacheWrite)}`,
	].join(" | ");
}

export default function conversationMetrics(pi: ExtensionAPI) {
	let round: RoundStats | undefined;
	let lastSummary = "暂无本轮统计";

	function ensureRound(): RoundStats {
		if (!round) {
			round = { startedAtMs: Date.now(), timings: [] };
		}
		return round;
	}

	function beginTiming(): AssistantTiming {
		const state = ensureRound();
		const timing: AssistantTiming = { requestStartMs: Date.now() };
		state.timings.push(timing);
		state.activeTiming = timing;
		return timing;
	}

	function getActiveTiming(): AssistantTiming {
		const state = ensureRound();
		if (!state.activeTiming) {
			const timing: AssistantTiming = { requestStartMs: Date.now() };
			state.timings.push(timing);
			state.activeTiming = timing;
		}
		return state.activeTiming;
	}

	pi.on("agent_start", async () => {
		round = { startedAtMs: Date.now(), timings: [] };
	});

	pi.on("before_provider_request", () => {
		beginTiming();
	});

	pi.on("message_start", (event) => {
		if (!isAssistantMessage(event.message)) return;
		getActiveTiming();
	});

	pi.on("message_update", (event) => {
		if (!isAssistantMessage(event.message)) return;
		const timing = getActiveTiming();
		if (timing.firstOutputMs === undefined && isFirstOutputEvent(event.assistantMessageEvent)) {
			timing.firstOutputMs = Date.now();
		}
	});

	pi.on("message_end", (event) => {
		if (!isAssistantMessage(event.message)) return;
		const timing = getActiveTiming();
		const now = Date.now();
		if (timing.firstOutputMs === undefined) timing.firstOutputMs = now;
		timing.endMs = now;
		const state = ensureRound();
		if (state.activeTiming === timing) state.activeTiming = undefined;
	});

	pi.on("agent_end", async (event, ctx) => {
		const usage = emptyUsage();
		for (const message of event.messages) {
			if (isAssistantMessage(message)) addUsage(usage, (message as any).usage);
		}

		const timings = round?.timings ?? [];
		lastSummary = `本轮统计: ${buildSummary(usage, timings)}`;

		if (ctx.hasUI) {
			ctx.ui.setWidget(WIDGET_KEY, [lastSummary], { placement: "belowEditor" });
			ctx.ui.notify(lastSummary, "info");
		}

		round = undefined;
	});

	pi.registerCommand("metrics", {
		description: "Show the latest per-round INPUT/OUTPUT/TOKEN/cache/TTFT/TPS metrics",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			ctx.ui.notify(lastSummary, "info");
			ctx.ui.setWidget(WIDGET_KEY, [lastSummary], { placement: "belowEditor" });
		},
	});
}
