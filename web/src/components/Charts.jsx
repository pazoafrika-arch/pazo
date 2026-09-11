import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { tzs, num } from '../lib/format.js';

/**
 * Charts share one visual language: a single teal series by default, a quiet
 * horizontal-only grid, tabular numbers, and axis labels that thin out on
 * narrow screens rather than overlapping.
 */

const TEAL = '#01989f';
const NAVY = '#0f3460';
export const SERIES_COLORS = [TEAL, NAVY, '#0e9aa7', '#b45309', '#6366f1'];

const axisStyle = { fontSize: 11, fill: '#7A9AAA', fontWeight: 500 };

const shortDate = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()}/${d.getMonth() + 1}`;
};

const compactAxis = (v) => {
  const n = Number(v);
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
};

function ChartTooltip({ active, payload, label, money = true, labelName = 'Date' }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: 'var(--navy)',
        color: '#fff',
        padding: '10px 13px',
        borderRadius: 'var(--r-sm)',
        fontSize: 'var(--t-sm)',
        boxShadow: 'var(--shadow-lg)',
        lineHeight: 1.6,
        minWidth: 120,
      }}
    >
      <div style={{ color: 'rgba(255,255,255,.55)', fontSize: 'var(--t-xs)', marginBottom: 3 }}>
        {labelName === 'Date'
          ? new Date(label).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })
          : label}
      </div>
      {payload.map((p) => (
        <div
          key={p.dataKey}
          style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: p.color || p.fill,
              flexShrink: 0,
            }}
          />
          {p.name && payload.length > 1 ? `${p.name}: ` : ''}
          {money ? tzs(p.value) : num(p.value)}
        </div>
      ))}
    </div>
  );
}

/** Daily bars — the business and admin sales charts. */
export function DailyBarChart({ data, height = 260, money = true, color = TEAL, dataKey = 'value' }) {
  // On a 30-day series, label roughly every 5th day so ticks never collide.
  const interval = data.length > 20 ? Math.floor(data.length / 6) : 0;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis
          dataKey="date"
          tickFormatter={shortDate}
          tick={axisStyle}
          axisLine={false}
          tickLine={false}
          interval={interval}
          minTickGap={8}
        />
        <YAxis
          tickFormatter={compactAxis}
          tick={axisStyle}
          axisLine={false}
          tickLine={false}
          width={54}
        />
        <Tooltip
          content={<ChartTooltip money={money} />}
          cursor={{ fill: 'rgba(1,152,159,0.08)' }}
        />
        <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Filled trend line — earnings over time. */
export function TrendAreaChart({ data, height = 220, money = true, color = TEAL }) {
  const interval = data.length > 20 ? Math.floor(data.length / 6) : 0;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="pazoArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.26} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis
          dataKey="date"
          tickFormatter={shortDate}
          tick={axisStyle}
          axisLine={false}
          tickLine={false}
          interval={interval}
          minTickGap={8}
        />
        <YAxis
          tickFormatter={compactAxis}
          tick={axisStyle}
          axisLine={false}
          tickLine={false}
          width={54}
        />
        <Tooltip content={<ChartTooltip money={money} />} cursor={{ stroke: color, strokeWidth: 1 }} />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2.2}
          fill="url(#pazoArea)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Two comparable series, e.g. commissions against platform fees. */
export function DualLineChart({ data, height = 250, seriesA, seriesB }) {
  const interval = data.length > 20 ? Math.floor(data.length / 6) : 0;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis
          dataKey="date"
          tickFormatter={shortDate}
          tick={axisStyle}
          axisLine={false}
          tickLine={false}
          interval={interval}
          minTickGap={8}
        />
        <YAxis
          tickFormatter={compactAxis}
          tick={axisStyle}
          axisLine={false}
          tickLine={false}
          width={54}
        />
        <Tooltip content={<ChartTooltip />} />
        <Line
          type="monotone"
          dataKey={seriesA.key}
          name={seriesA.label}
          stroke={TEAL}
          strokeWidth={2.2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey={seriesB.key}
          name={seriesB.label}
          stroke={NAVY}
          strokeWidth={2.2}
          strokeDasharray="4 3"
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Composition donut — partner mix, transaction types. */
export function DonutChart({ data, height = 200, money = false }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div style={{ position: 'relative' }}>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="90%"
            paddingAngle={2}
            stroke="none"
          >
            {data.map((entry, i) => (
              <Cell key={entry.name} fill={entry.color || SERIES_COLORS[i % SERIES_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip money={money} labelName="Segment" />} />
        </PieChart>
      </ResponsiveContainer>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeContent: 'center',
          textAlign: 'center',
          pointerEvents: 'none',
        }}
      >
        <div style={{ fontSize: 'var(--t-2xl)', fontWeight: 800, color: 'var(--navy)' }}>
          {money ? tzs(total, { compact: true }) : num(total)}
        </div>
        <div style={{ fontSize: 'var(--t-xs)', color: 'var(--text-3)', fontWeight: 600 }}>Total</div>
      </div>
    </div>
  );
}

/** Legend shared by the donut and any multi-series chart. */
export function ChartLegend({ items }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-4)', marginTop: 'var(--s-3)' }}>
      {items.map((item, i) => (
        <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              background: item.color || SERIES_COLORS[i % SERIES_COLORS.length],
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 'var(--t-sm)', color: 'var(--text-2)', fontWeight: 500 }}>
            {item.name}
          </span>
          {item.value !== undefined && (
            <span style={{ fontSize: 'var(--t-sm)', color: 'var(--text-3)' }}>{item.value}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Inline sparkline for table rows and compact cards. */
export function Sparkline({ data, width = 90, height = 28, color = TEAL }) {
  if (!data?.length) return null;
  const values = data.map((d) => (typeof d === 'number' ? d : d.value));
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = width / Math.max(1, values.length - 1);

  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`)
    .join(' ');

  return (
    <svg width={width} height={height} aria-hidden="true" style={{ display: 'block' }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
