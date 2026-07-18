# `@relay/reference-components`

Manually authored reference components demonstrate the public `@relay/component-sdk` contract for coding agents and product tests. They are examples of component quality and structure, not hidden renderer APIs.

## Animated line chart

`lineChart` is a deterministic SVG/React component driven only by validated input and Relay frame context. It supports:

- up to 60 labeled observations per series;
- up to four visually distinct series;
- optional frame-driven line drawing;
- highlighted series and data points;
- channel color, font, and spacing tokens;
- exact 4K, 1440p, 1080p, 720p, and 960×540 output dimensions;
- intentional empty-data rendering;
- representative, empty, and dense fixtures with checkpoint frames.

Numeric inputs are bounded to ±1 trillion so valid data cannot overflow SVG geometry. Visible titles, labels, and legends are shortened when necessary while the full chart title remains available through its accessible label.

Use `invalidLineChartInputs` to exercise actionable project-input failures. See `src/line-chart.tsx` and `test/line-chart.test.ts` for the implementation and deterministic examples.

This package does not import Remotion, access the network or environment, read browser dimensions, or use ambient clocks or randomness. Preview and rendering hosts supply the exact frame, duration, dimensions, theme, and assets through the public SDK.
