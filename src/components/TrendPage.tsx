import { useState, useMemo } from "react";
import { subDays, format, parseISO } from "date-fns";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { useNavigate } from "react-router-dom";
import type { AppDataHandle } from "../appDataType";
import type {
  DayLog,
  Food,
  NutritionGoals,
  WeightLossPlan,
} from "../types";
import { sumNutrition } from "../nutrition";
import { computeExpectedWeight } from "../calculator";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";

type TimeRange = "7d" | "30d" | "90d" | "all";

const TIME_RANGE_OPTIONS: ReadonlyArray<{ value: TimeRange; label: string }> = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "all", label: "All" },
];

const TIME_RANGE_DAYS: Record<TimeRange, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

interface NutritionDataPoint {
  date: string;
  label: string;
  calories: number;
  protein: number;
  saturatedFat: number;
  fiber: number;
}

interface WeightDataPoint {
  date: string;
  label: string;
  weight: number;
  expected: number | null;
}

function buildNutritionData(
  dayLogs: ReadonlyArray<DayLog>,
  foodsMap: Map<string, Food>,
  range: TimeRange,
): NutritionDataPoint[] {
  const cutoff = TIME_RANGE_DAYS[range];
  const cutoffDate = cutoff != null ? subDays(new Date(), cutoff) : null;

  const points: NutritionDataPoint[] = [];

  for (const dl of dayLogs) {
    if (dl.entries.length === 0) continue;

    const parsed = parseISO(dl.date);
    if (cutoffDate != null && parsed < cutoffDate) continue;

    const hasFoodEntries = dl.entries.some((e) => e.type !== "separator");
    if (!hasFoodEntries) continue;

    const totals = sumNutrition(dl.entries, foodsMap, { status: "consumed" });
    points.push({
      date: dl.date,
      label: format(parsed, "MMM d"),
      calories: Math.round(totals.calories),
      protein: Math.round(totals.protein),
      saturatedFat: Math.round(totals.saturatedFat * 10) / 10,
      fiber: Math.round(totals.fiber * 10) / 10,
    });
  }

  points.sort((a, b) => a.date.localeCompare(b.date));
  return points;
}

function buildWeightData(
  dayLogs: ReadonlyArray<DayLog>,
  weightLossPlan: WeightLossPlan | null,
  range: TimeRange,
): WeightDataPoint[] {
  const cutoff = TIME_RANGE_DAYS[range];
  const cutoffDate = cutoff != null ? subDays(new Date(), cutoff) : null;

  const points: WeightDataPoint[] = [];

  for (const dl of dayLogs) {
    if (dl.weightKg == null) continue;

    const parsed = parseISO(dl.date);
    if (cutoffDate != null && parsed < cutoffDate) continue;

    const expected =
      weightLossPlan != null
        ? computeExpectedWeight(weightLossPlan, dl.date)
        : null;

    points.push({
      date: dl.date,
      label: format(parsed, "MMM d"),
      weight: dl.weightKg,
      expected,
    });
  }

  points.sort((a, b) => a.date.localeCompare(b.date));
  return points;
}

const KCAL_PER_GRAM_FAT = 9;

function getSatFatGoalGrams(goals: NutritionGoals): number {
  if (goals.saturatedFatMode === "percentage") {
    return (goals.calories * goals.saturatedFat) / 100 / KCAL_PER_GRAM_FAT;
  }
  return goals.saturatedFat;
}

interface MetricChartProps {
  title: string;
  data: NutritionDataPoint[];
  dataKey: string;
  color: string;
  unit: string;
  goalValue: number | null;
  goalLabel: string;
}

function MetricChart({
  title,
  data,
  dataKey,
  color,
  unit,
  goalValue,
  goalLabel,
}: MetricChartProps) {
  if (data.length === 0) {
    return (
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No data available for this period.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data}>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "hsl(215, 15%, 55%)" }}
              axisLine={{ stroke: "hsl(240, 10%, 18%)" }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: "hsl(215, 15%, 55%)" }}
              axisLine={false}
              tickLine={false}
              width={45}
              domain={["auto", "auto"]}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(240, 12%, 8%)",
                border: "1px solid hsl(240, 10%, 18%)",
                borderRadius: "8px",
                fontSize: "12px",
                color: "hsl(210, 20%, 95%)",
              }}
              formatter={(value) => [`${String(value)}${unit}`, title]}
            />
            {goalValue != null && (
              <ReferenceLine
                y={goalValue}
                stroke="hsl(215, 15%, 55%)"
                strokeDasharray="6 3"
                label={{
                  value: `${goalLabel}: ${Math.round(goalValue)}${unit}`,
                  position: "insideTopRight",
                  style: {
                    fontSize: 10,
                    fill: "hsl(215, 15%, 55%)",
                  },
                }}
              />
            )}
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={2}
              dot={{ r: 3, fill: color }}
              activeDot={{ r: 5, fill: color }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

interface WeightChartProps {
  data: WeightDataPoint[];
}

function WeightChart({ data }: WeightChartProps) {
  if (data.length === 0) {
    return (
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Weight</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No weight data available for this period.
          </p>
        </CardContent>
      </Card>
    );
  }

  const hasExpected = data.some((d) => d.expected != null);

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Weight</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data}>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "hsl(215, 15%, 55%)" }}
              axisLine={{ stroke: "hsl(240, 10%, 18%)" }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: "hsl(215, 15%, 55%)" }}
              axisLine={false}
              tickLine={false}
              width={45}
              domain={["auto", "auto"]}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(240, 12%, 8%)",
                border: "1px solid hsl(240, 10%, 18%)",
                borderRadius: "8px",
                fontSize: "12px",
                color: "hsl(210, 20%, 95%)",
              }}
              formatter={(value, name) => [
                `${String(value)} kg`,
                name === "weight" ? "Actual" : "Expected",
              ]}
            />
            <Line
              type="monotone"
              dataKey="weight"
              stroke="hsl(152, 76%, 42%)"
              strokeWidth={2}
              dot={{ r: 3, fill: "hsl(152, 76%, 42%)" }}
              activeDot={{ r: 5, fill: "hsl(152, 76%, 42%)" }}
              connectNulls
            />
            {hasExpected && (
              <Line
                type="monotone"
                dataKey="expected"
                stroke="hsl(215, 15%, 55%)"
                strokeWidth={1.5}
                strokeDasharray="6 3"
                dot={false}
                connectNulls
              />
            )}
          </LineChart>
        </ResponsiveContainer>
        {hasExpected && (
          <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-4 rounded"
                style={{ backgroundColor: "hsl(152, 76%, 42%)" }}
              />
              Actual
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-4 rounded border-t border-dashed"
                style={{ borderColor: "hsl(215, 15%, 55%)" }}
              />
              Expected
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface TrendPageProps {
  appData: AppDataHandle;
}

export function TrendPage({ appData }: TrendPageProps) {
  const navigate = useNavigate();
  const { activeProfile, foodsMap } = appData;
  const [range, setRange] = useState<TimeRange>("30d");

  const nutritionData = useMemo(() => {
    if (activeProfile == null) return [];
    return buildNutritionData(activeProfile.dayLogs, foodsMap, range);
  }, [activeProfile, foodsMap, range]);

  const weightData = useMemo(() => {
    if (activeProfile == null) return [];
    return buildWeightData(
      activeProfile.dayLogs,
      activeProfile.weightLossPlan ?? null,
      range,
    );
  }, [activeProfile, range]);

  const goals = activeProfile?.goals ?? null;

  if (activeProfile == null) {
    return (
      <div className="p-4">
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <p className="mb-3">
              No profile selected. Create one to see trends.
            </p>
            <Button onClick={() => navigate("/profiles")}>
              Go to Profiles
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h1 className="mb-1 text-lg font-bold">Trends</h1>
      <p className="mb-4 text-xs text-muted-foreground">
        {activeProfile.name}
      </p>

      <div className="mb-4 flex gap-1">
        {TIME_RANGE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setRange(opt.value)}
            className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              range === opt.value
                ? "border-primary bg-primary/10 text-primary"
                : "border-input hover:bg-accent"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <MetricChart
        title="Calories"
        data={nutritionData}
        dataKey="calories"
        color="hsl(45, 93%, 58%)"
        unit=" kcal"
        goalValue={goals?.calories ?? null}
        goalLabel="Goal"
      />

      <MetricChart
        title="Protein"
        data={nutritionData}
        dataKey="protein"
        color="hsl(217, 91%, 60%)"
        unit="g"
        goalValue={goals?.protein ?? null}
        goalLabel="Goal"
      />

      <MetricChart
        title="Saturated Fat"
        data={nutritionData}
        dataKey="saturatedFat"
        color="hsl(0, 84%, 60%)"
        unit="g"
        goalValue={goals != null ? getSatFatGoalGrams(goals) : null}
        goalLabel="Limit"
      />

      <MetricChart
        title="Fiber"
        data={nutritionData}
        dataKey="fiber"
        color="hsl(152, 76%, 42%)"
        unit="g"
        goalValue={goals?.fiber ?? null}
        goalLabel="Goal"
      />

      <WeightChart data={weightData} />
    </div>
  );
}
