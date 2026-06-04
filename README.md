# pi-turn-metrics

A [Pi](https://pi.dev) extension that displays per-turn model metrics after each conversation round.

It shows:

- `INPUT` prompt/input tokens
- `OUTPUT` completion/output tokens
- `TOKEN` total tokens
- `CACHE` prompt cache hit rate
- `TTFT(avg)` average time to first token / first output event
- `TPS` provider-reported output tokens per second
- `R` cache read tokens
- `W` cache write tokens

Example output:

```text
本轮统计: INPUT 12.3k | OUTPUT 1.2k | TOKEN 18.4k | CACHE 63.5% | TTFT(avg) 820ms | TPS 42.7 tok/s | R 5.8k | W 0
```

The summary is displayed after each agent round via Pi's notification UI. It intentionally does not occupy the footer/status line while waiting or collecting metrics.

## Install

Install globally from GitHub:

```bash
pi install git:git@github.com:LiangYin233/pi-turn-metrics.git
```

Then restart Pi or run:

```text
/reload
```

## Usage

Start Pi normally. After each conversation round finishes, the metrics summary appears automatically.

You can also show the latest summary again with:

```text
/metrics
```

## Metric definitions

- `INPUT`: Sum of Pi-normalized `usage.input` from all assistant messages in the round. Cached input is reported separately as `R`/`W`.
- `OUTPUT`: Sum of Pi-normalized provider-reported `usage.output` from all assistant messages in the round.
- `TOKEN`: Sum of provider-reported `usage.totalTokens`; falls back to `input + output + cacheRead + cacheWrite` when a provider reports `0`/missing total tokens.
- `CACHE`: Whole-round prompt cache hit rate: `sum(cacheRead) / (sum(input) + sum(cacheRead) + sum(cacheWrite))`.
- `TTFT(avg)`: Average time from provider request payload emission to the first observed output event.
- `TPS`: Sum of timed assistant-message `usage.output` divided by provider request time. Provider request time is measured from provider request payload emission to assistant message end, so it includes TTFT but excludes tool execution time. This uses provider-reported `usage.output`, so hidden reasoning tokens and tool-call structure tokens are included when the provider includes them.
- `R`: Cache read tokens.
- `W`: Cache write tokens.

Provider behavior may vary. `OUTPUT`, `TOKEN`, and `TPS` follow provider-reported usage. Pi's normalized `usage` currently does not expose a separate reasoning-token field for OpenAI Responses (`output_tokens_details.reasoning_tokens`), so this extension cannot split reasoning tokens out unless Pi's provider usage normalization preserves that detail.

## Local development

Load the package from a local checkout:

```bash
pi --no-extensions -e /path/to/pi-turn-metrics
```

Or load the extension file directly:

```bash
pi --no-extensions -e /path/to/pi-turn-metrics/extensions/turn-metrics.ts
```

## License

MIT
