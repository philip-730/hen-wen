'use client'

import React, { memo } from 'react'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart'
import {
  BarChart, Bar, XAxis, YAxis,
  LineChart, Line,
  PieChart, Pie, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
} from 'recharts'

export interface ChartSpec {
  type: 'bar' | 'line' | 'pie' | 'radar'
  x_key: string
  y_keys: string[]
  title?: string
  group_key?: string  // radar only: split rows by this column, one chart per unique value
}

const COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
]

function toNumber(v: string) {
  const n = parseFloat(v)
  return isNaN(n) ? 0 : n
}

function buildChartData(rows: Record<string, string>[], x_key: string, y_keys: string[]) {
  return rows.map(row => {
    const item: Record<string, string | number> = { [x_key]: row[x_key] ?? '' }
    for (const key of y_keys) item[key] = toNumber(row[key])
    return item
  })
}

function buildConfig(y_keys: string[]): ChartConfig {
  return Object.fromEntries(
    y_keys.map((key, i) => [key, { label: key, color: COLORS[i % COLORS.length] }])
  )
}

const AXIS_PROPS = {
  tick: { fontSize: 10 },
  tickLine: false,
  axisLine: false,
}

export const DataChart = memo(function DataChart({ spec, rows }: { spec: ChartSpec; rows: Record<string, string>[] }) {
  // Guard: drop any y_keys that don't exist in the data
  const availableKeys = rows.length > 0 ? Object.keys(rows[0]) : []
  const validYKeys = spec.y_keys.filter(k => availableKeys.includes(k))
  if (validYKeys.length === 0 || !availableKeys.includes(spec.x_key)) return null

  const safeSpec = { ...spec, y_keys: validYKeys }
  const data = buildChartData(rows, safeSpec.x_key, safeSpec.y_keys)
  const config = buildConfig(safeSpec.y_keys)
  const showLegend = safeSpec.y_keys.length > 1

  function wrap(chart: React.ReactNode) {
    return (
      <div className="mt-3 w-full">
        {safeSpec.title && <p className="text-xs font-medium text-muted-foreground mb-1">{safeSpec.title}</p>}
        {chart}
      </div>
    )
  }

  if (safeSpec.type === 'bar') {
    return wrap(
      <ChartContainer config={config} className="h-80 w-full">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
          <XAxis dataKey={safeSpec.x_key} {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} width={32} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {showLegend && <ChartLegend content={<ChartLegendContent />} />}
          {safeSpec.y_keys.map((key, i) => (
            <Bar key={key} dataKey={key} fill={COLORS[i % COLORS.length]} radius={[3, 3, 0, 0]} />
          ))}
        </BarChart>
      </ChartContainer>
    )
  }

  if (safeSpec.type === 'line') {
    return wrap(
      <ChartContainer config={config} className="h-80 w-full">
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
          <XAxis dataKey={safeSpec.x_key} {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} width={32} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {showLegend && <ChartLegend content={<ChartLegendContent />} />}
          {safeSpec.y_keys.map((key, i) => (
            <Line key={key} type="monotone" dataKey={key} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
          ))}
        </LineChart>
      </ChartContainer>
    )
  }

  if (safeSpec.type === 'pie') {
    const pieConfig: ChartConfig = Object.fromEntries(
      data.map((item, i) => [
        String(item[safeSpec.x_key]),
        { label: String(item[safeSpec.x_key]), color: COLORS[i % COLORS.length] },
      ])
    )
    const valueKey = safeSpec.y_keys[0]
    return wrap(
      <ChartContainer config={pieConfig} className="h-80 w-full">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent nameKey={safeSpec.x_key} />} />
          <Pie data={data} dataKey={valueKey} nameKey={safeSpec.x_key} cx="50%" cy="50%" outerRadius={80}>
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <ChartLegend content={<ChartLegendContent nameKey={safeSpec.x_key} />} />
        </PieChart>
      </ChartContainer>
    )
  }

  if (safeSpec.type === 'radar') {
    // If group_key is set, split rows into one chart per group value
    if (safeSpec.group_key && availableKeys.includes(safeSpec.group_key)) {
      const groupKey = safeSpec.group_key
      const groups = [...new Set(rows.map(r => String(r[groupKey])))]
      return (
        <div className="mt-3 space-y-1">
          {safeSpec.title && <p className="text-xs font-medium text-muted-foreground mb-1">{safeSpec.title}</p>}
          {groups.map(group => (
            <DataChart
              key={group}
              spec={{ ...spec, group_key: undefined, title: group }}
              rows={rows.filter(r => String(r[groupKey]) === group)}
            />
          ))}
        </div>
      )
    }

    // Pivot whenever we have multiple stat columns:
    // stats go on the outer axes, each entity (pokemon) becomes a separate radar shape
    // e.g. [{Name:"Charizard", HP:78, ...}, {Name:"Mewtwo", HP:106, ...}]
    //   → [{stat:"HP", Charizard:78, Mewtwo:106}, ...]
    const shouldPivot = safeSpec.y_keys.length > 1
    if (shouldPivot) {
      // Deduplicate entities by x_key to avoid duplicate recharts keys
      const seen = new Set<string>()
      const uniqueRows = rows.filter(r => {
        const name = String(r[safeSpec.x_key])
        if (seen.has(name)) return false
        seen.add(name)
        return true
      })
      const entities = uniqueRows.map(r => String(r[safeSpec.x_key]))
      const pivotedData = safeSpec.y_keys.map(stat => {
        const point: Record<string, string | number> = { stat }
        uniqueRows.forEach(r => { point[String(r[safeSpec.x_key])] = toNumber(r[stat]) })
        return point
      })
      const pivotConfig: ChartConfig = Object.fromEntries(
        entities.map((name, i) => [name, { label: name, color: COLORS[i % COLORS.length] }])
      )
      return wrap(
        <ChartContainer config={pivotConfig} className="h-80 w-full">
          <RadarChart data={pivotedData} cx="50%" cy="50%" outerRadius={90}>
            <PolarGrid />
            <PolarAngleAxis dataKey="stat" tick={{ fontSize: 11 }} />
            <ChartTooltip content={<ChartTooltipContent />} />
            {entities.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
            {entities.map((name, i) => (
              <Radar key={`${name}-${i}`} dataKey={name} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.2} />
            ))}
          </RadarChart>
        </ChartContainer>
      )
    }
    return wrap(
      <ChartContainer config={config} className="h-80 w-full">
        <RadarChart data={data} cx="50%" cy="50%" outerRadius={90}>
          <PolarGrid />
          <PolarAngleAxis dataKey={safeSpec.x_key} tick={{ fontSize: 11 }} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {showLegend && <ChartLegend content={<ChartLegendContent />} />}
          {safeSpec.y_keys.map((key, i) => (
            <Radar key={key} dataKey={key} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.25} />
          ))}
        </RadarChart>
      </ChartContainer>
    )
  }

  return null
})
