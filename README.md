# pi-turn-metrics

A [Pi](https://pi.dev) extension that displays per-turn model metrics after each conversation round.

It shows:

- `INPUT` prompt/input tokens
- `OUTPUT` completion/output tokens
- `TOKEN` total tokens
- `CACHE` prompt cache hit rate
- `TTFT(avg)` average time to first token / first output event
- `TPS` output tokens per second
- `R` cache read tokens
- `W` cache write tokens

Example output:

```text
本轮统计: INPUT 12.3k | OUTPUT 1.2k | TOKEN 18.4k | CACHE 63.5% | TTFT(avg) 820ms | TPS 42.7 tok/s | R 5.8k | W 0
```

The summary is displayed after each agent round via Pi's notification UI and a widget below the editor. It intentionally does not occupy the footer/status line while waiting or collecting metrics.

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

- `INPUT`: Sum of `usage.input` from all assistant messages in the round.
- `OUTPUT`: Sum of `usage.output` from all assistant messages in the round.
- `TOKEN`: Sum of `usage.totalTokens` from all assistant messages in the round.
- `CACHE`: `cacheRead / (input + cacheRead + cacheWrite)`.
- `TTFT(avg)`: Average time from provider request payload emission to the first observed output event.
- `TPS`: `OUTPUT / streaming generation time`, where generation time is measured from first output event to assistant message end and excludes tool execution time.
- `R`: Cache read tokens.
- `W`: Cache write tokens.

Provider behavior may vary. If a provider counts hidden reasoning tokens in `usage.output` but does not stream them, `TPS` follows the provider-reported token usage.

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
