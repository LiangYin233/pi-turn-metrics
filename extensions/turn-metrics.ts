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
	outputTokens?: number;
};

type RoundStats = {
	timings: AssistantTiming[];
	activeTiming?: AssistantTiming;
	pendingRequestStartMs?: number;
};

function nonNegativeNumber(value: unknown): number {
	const number = Number(value ?? 0);
	return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function emptyUsage(): UsageTotals {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
}

function addUsage(total: UsageTotals, usage: any): void {
	if (!usage) return;
	const input = nonNegativeNumber(usage.input);
	const output = nonNegativeNumber(usage.output);
	const cacheRead = nonNegativeNumber(usage.cacheRead);
	const cacheWrite = nonNegativeNumber(usage.cacheWrite);
	const computedTotalTokens = input + output + cacheRead + cacheWrite;
	const reportedTotalTokens = nonNegativeNumber(usage.totalTokens);
	const totalTokens = Math.max(reportedTotalTokens, computedTotalTokens);

	total.input += input;
	total.output += output;
	total.cacheRead += cacheRead;
	total.cacheWrite += cacheWrite;
	total.totalTokens += totalTokens;
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
	if (streamEvent.type === "text_end" || streamEvent.type === "thinking_end") {
		return typeof streamEvent.content === "string" && streamEvent.content.length > 0;
	}
	return streamEvent.type === "toolcall_end";
}

function hasObservableAssistantOutput(message: any): boolean {
	if (!Array.isArray(message?.content)) return false;
	return message.content.some((block: any) => {
		if (block?.type === "toolCall") return true;
		if (block?.type === "text") return typeof block.text === "string" && block.text.length > 0;
		if (block?.type === "thinking") return typeof block.thinking === "string" && block.thinking.length > 0;
		return false;
	});
}

function summarizeTimings(timings: AssistantTiming[]): { avgFirstOutputMs?: number; tokensPerSecond?: number } {
	const completedTimings = timings.filter((timing) => timing.endMs !== undefined);
	const firstOutputLatencies = completedTimings
		.filter((timing) => timing.firstOutputMs !== undefined)
		.map((timing) => Math.max(0, (timing.firstOutputMs as number) - timing.requestStartMs));

	const avgFirstOutputMs =
		firstOutputLatencies.length > 0
			? firstOutputLatencies.reduce((sum, value) => sum + value, 0) / firstOutputLatencies.length
			: undefined;

	const requestMs = completedTimings.reduce((sum, timing) => {
		return sum + Math.max(0, (timing.endMs as number) - timing.requestStartMs);
	}, 0);
	const measuredOutputTokens = completedTimings.reduce((sum, timing) => sum + nonNegativeNumber(timing.outputTokens), 0);

	const tokensPerSecond = requestMs > 0 && measuredOutputTokens > 0 ? measuredOutputTokens / (requestMs / 1_000) : undefined;
	return { avgFirstOutputMs, tokensPerSecond };
}

function buildSummary(usage: UsageTotals, timings: AssistantTiming[]): string {
	const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
	const cacheHitRate = promptTokens > 0 ? (usage.cacheRead / promptTokens) * 100 : undefined;
	const timingSummary = summarizeTimings(timings);

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

	function beginTiming(): void {
		const state = round;
		if (!state) return;
		// Some providers/transports can emit more than one payload hook for the
		// same assistant response. Keep the earliest request start until the
		// assistant message binds to it; never overwrite an in-flight response.
		if (state.activeTiming && state.activeTiming.endMs === undefined) return;
		state.pendingRequestStartMs ??= Date.now();
	}

	function getActiveTiming(): AssistantTiming | undefined {
		const state = round;
		if (!state) return undefined;
		if (!state.activeTiming) {
			const timing: AssistantTiming = { requestStartMs: state.pendingRequestStartMs ?? Date.now() };
			state.pendingRequestStartMs = undefined;
			state.timings.push(timing);
			state.activeTiming = timing;
		}
		return state.activeTiming;
	}

	pi.on("agent_start", async () => {
		round = { timings: [] };
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
		if (!timing) return;
		if (timing.firstOutputMs === undefined && isFirstOutputEvent(event.assistantMessageEvent)) {
			timing.firstOutputMs = Date.now();
		}
	});

	pi.on("message_end", (event) => {
		if (!isAssistantMessage(event.message)) return;
		const timing = getActiveTiming();
		const state = round;
		if (!timing || !state) return;
		const now = Date.now();
		if (timing.firstOutputMs === undefined && hasObservableAssistantOutput(event.message)) timing.firstOutputMs = now;
		timing.endMs = now;
		timing.outputTokens = nonNegativeNumber((event.message as any).usage?.output);
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
			ctx.ui.notify(lastSummary, "info");
		}

		round = undefined;
	});

	pi.registerCommand("metrics", {
		description: "Show the latest per-round INPUT/OUTPUT/TOKEN/cache/TTFT/TPS metrics",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			ctx.ui.notify(lastSummary, "info");
		},
	});
}
