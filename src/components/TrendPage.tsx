import { useState, useMemo } from "react";
import {
  addDays,
  differenceInCalendarDays,
  format,
  parseISO,
  subDays,
} from "date-fns";
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
  UserMetrics,
  WeightLossPlan,
} from "../types";
import { sumNutrition } from "../nutrition";
import { computeExpectedWeight, computeTdee } from "../calculator";
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

const DATE_KEY_FORMAT = "yyyy-MM-dd";

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
  weight: number | null;
  expected: number | null;
}

interface MetricReferenceLine {
  value: number;
  label: string;
  stroke: string;
  strokeDasharray: string;
  labelPosition: "insideTopRight" | "insideBottomRight";
}

const DEFAULT_REFERENCE_STROKE = "hsl(215, 15%, 55%)";
const MAINTENANCE_REFERENCE_STROKE = "hsl(217, 91%, 60%)";

function formatDateKey(date: Date): string {
  return format(date, DATE_KEY_FORMAT);
}

function getRangeCutoffDate(range: TimeRange): Date | null {
  const cutoff = TIME_RANGE_DAYS[range];
  return cutoff != null ? subDays(new Date(), cutoff) : null;
}

function buildNutritionData(
  dayLogs: ReadonlyArray<DayLog>,
  foodsMap: Map<string, Food>,
  range: TimeRange,
): NutritionDataPoint[] {
  const cutoffDate = getRangeCutoffDate(range);

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
  extendToGoalDate: boolean,
): WeightDataPoint[] {
  const cutoffDate = getRangeCutoffDate(range);

  const pointsByDate = new Map<string, WeightDataPoint>();

  for (const dl of dayLogs) {
    if (dl.weightKg == null) continue;

    const parsed = parseISO(dl.date);
    if (cutoffDate != null && parsed < cutoffDate) continue;

    const expected =
      weightLossPlan != null
        ? computeExpectedWeight(weightLossPlan, dl.date)
        : null;

    pointsByDate.set(dl.date, {
      date: dl.date,
      label: format(parsed, "MMM d"),
      weight: dl.weightKg,
      expected,
    });
  }

  if (extendToGoalDate && weightLossPlan != null) {
    const goalDate = getWeightPlanGoalDate(weightLossPlan);
    const latestActualDate = getLatestDateKey(Array.from(pointsByDate.keys()));
    const projectionStartDate = getLatestDateKey([
      weightLossPlan.startDate,
      formatDateKey(new Date()),
      cutoffDate != null ? formatDateKey(cutoffDate) : null,
      latestActualDate,
    ]);

    if (
      goalDate != null &&
      projectionStartDate != null &&
      projectionStartDate.localeCompare(goalDate) <= 0
    ) {
      let currentDate = parseISO(projectionStartDate);
      const endDate = parseISO(goalDate);

      while (currentDate <= endDate) {
        const date = formatDateKey(currentDate);
        const existing = pointsByDate.get(date);

        pointsByDate.set(date, {
          date,
          label: format(currentDate, "MMM d"),
          weight: existing?.weight ?? null,
          expected: computeExpectedWeight(weightLossPlan, date),
        });

        currentDate = addDays(currentDate, 1);
      }
    }
  }

  return Array.from(pointsByDate.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

const KCAL_PER_GRAM_FAT = 9;

function getSatFatGoalGrams(goals: NutritionGoals): number {
  if (goals.saturatedFatMode === "percentage") {
    return (goals.calories * goals.saturatedFat) / 100 / KCAL_PER_GRAM_FAT;
  }
  return goals.saturatedFat;
}

function getMaintenanceCalories(metrics: UserMetrics | null): number | null {
  if (metrics == null) return null;

  return Math.round(
    computeTdee(
      metrics.sex,
      metrics.weightKg,
      metrics.heightCm,
      metrics.age,
      metrics.activityLevel,
    ),
  );
}

function getWeightPlanGoalDate(plan: WeightLossPlan): string | null {
  const totalLossKg = plan.startWeightKg - plan.targetWeightKg;
  if (totalLossKg <= 0 || plan.weeklyLossRateKg <= 0) return null;

  const daysToGoal = Math.ceil((totalLossKg / plan.weeklyLossRateKg) * 7);
  return formatDateKey(addDays(parseISO(plan.startDate), daysToGoal));
}

function getLatestDateKey(dates: ReadonlyArray<string | null>): string | null {
  let latestDate: string | null = null;

  for (const date of dates) {
    if (date == null) continue;
    if (latestDate == null || date.localeCompare(latestDate) > 0) {
      latestDate = date;
    }
  }

  return latestDate;
}

function buildGoalReferenceLines(
  value: number | null,
  label: string,
): MetricReferenceLine[] {
  if (value == null) return [];

  return [
    {
      value,
      label,
      stroke: DEFAULT_REFERENCE_STROKE,
      strokeDasharray: "6 3",
      labelPosition: "insideTopRight",
    },
  ];
}

function buildCalorieReferenceLines(
  goalValue: number | null,
  maintenanceValue: number | null,
): MetricReferenceLine[] {
  if (goalValue != null && maintenanceValue != null) {
    const roundedGoal = Math.round(goalValue);
    const roundedMaintenance = Math.round(maintenanceValue);

    if (roundedGoal === roundedMaintenance) {
      return [
        {
          value: goalValue,
          label: "Goal / Maintenance",
          stroke: DEFAULT_REFERENCE_STROKE,
          strokeDasharray: "6 3",
          labelPosition: "insideTopRight",
        },
      ];
    }

    return [
      {
        value: maintenanceValue,
        label: "Maintenance",
        stroke: MAINTENANCE_REFERENCE_STROKE,
        strokeDasharray: "2 2",
        labelPosition:
          maintenanceValue > goalValue ? "insideTopRight" : "insideBottomRight",
      },
      {
        value: goalValue,
        label: "Goal",
        stroke: DEFAULT_REFERENCE_STROKE,
        strokeDasharray: "6 3",
        labelPosition:
          goalValue > maintenanceValue ? "insideTopRight" : "insideBottomRight",
      },
    ];
  }

  if (maintenanceValue != null) {
    return [
      {
        value: maintenanceValue,
        label: "Maintenance",
        stroke: MAINTENANCE_REFERENCE_STROKE,
        strokeDasharray: "2 2",
        labelPosition: "insideTopRight",
      },
    ];
  }

  return buildGoalReferenceLines(goalValue, "Goal");
}

function formatDaysRemaining(days: number): string {
  return days === 1 ? "1 day remaining" : `${days} days remaining`;
}

interface MetricChartProps {
  title: string;
  data: NutritionDataPoint[];
  dataKey: string;
  color: string;
  unit: string;
  referenceLines?: MetricReferenceLine[];
}

function MetricChart({
  title,
  data,
  dataKey,
  color,
  unit,
  referenceLines = [],
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
            {referenceLines.map((line) => (
              <ReferenceLine
                key={`${line.label}-${line.value}`}
                y={line.value}
                stroke={line.stroke}
                strokeDasharray={line.strokeDasharray}
                label={{
                  value: `${line.label}: ${Math.round(line.value)}${unit}`,
                  position: line.labelPosition,
                  style: {
                    fontSize: 10,
                    fill: line.stroke,
                  },
                }}
              />
            ))}
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
  canExtendToGoal: boolean;
  daysUntilGoal: number | null;
  extendToGoal: boolean;
  goalDate: string | null;
  onToggleExtendToGoal: () => void;
}

function WeightChart({
  data,
  canExtendToGoal,
  daysUntilGoal,
  extendToGoal,
  goalDate,
  onToggleExtendToGoal,
}: WeightChartProps) {
  const goalDateLabel =
    goalDate != null ? format(parseISO(goalDate), "MMM d, yyyy") : null;
  const header = (
    <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
      <CardTitle>Weight</CardTitle>
      {canExtendToGoal && (
        <Button
          type="button"
          size="sm"
          variant={extendToGoal ? "secondary" : "outline"}
          className="h-8 px-2.5 text-xs"
          onClick={onToggleExtendToGoal}
        >
          {extendToGoal ? "Fit to data" : "Extend to goal"}
        </Button>
      )}
    </CardHeader>
  );

  if (data.length === 0) {
    return (
      <Card className="mb-4">
        {header}
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No weight data available for this period.
          </p>
        </CardContent>
      </Card>
    );
  }

  const hasActual = data.some((d) => d.weight != null);
  const hasExpected = data.some((d) => d.expected != null);

  return (
    <Card className="mb-4">
      {header}
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
                typeof value === "number" ? `${value.toFixed(1)} kg` : "",
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
        {(hasActual || hasExpected) && (
          <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
            {hasActual && (
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-0.5 w-4 rounded"
                  style={{ backgroundColor: "hsl(152, 76%, 42%)" }}
                />
                Actual
              </span>
            )}
            {hasExpected && (
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-0.5 w-4 rounded border-t border-dashed"
                  style={{ borderColor: "hsl(215, 15%, 55%)" }}
                />
                Expected
              </span>
            )}
          </div>
        )}
        {extendToGoal && daysUntilGoal != null && goalDateLabel != null && (
          <p className="mt-2 text-xs text-muted-foreground">
            Projected to {goalDateLabel} - {formatDaysRemaining(daysUntilGoal)}
          </p>
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
  const [extendWeightToGoal, setExtendWeightToGoal] = useState(true);

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
      extendWeightToGoal,
    );
  }, [activeProfile, extendWeightToGoal, range]);

  const goals = activeProfile?.goals ?? null;
  const maintenanceCalories = getMaintenanceCalories(
    activeProfile?.userMetrics ?? null,
  );
  const weightGoalDate =
    activeProfile?.weightLossPlan != null
      ? getWeightPlanGoalDate(activeProfile.weightLossPlan)
      : null;
  const daysUntilWeightGoal =
    weightGoalDate != null
      ? Math.max(
          differenceInCalendarDays(parseISO(weightGoalDate), new Date()),
          0,
        )
      : null;
  const canExtendWeightToGoal =
    daysUntilWeightGoal != null && daysUntilWeightGoal > 0;

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
        referenceLines={buildCalorieReferenceLines(
          goals?.calories ?? null,
          maintenanceCalories,
        )}
      />

      <MetricChart
        title="Protein"
        data={nutritionData}
        dataKey="protein"
        color="hsl(217, 91%, 60%)"
        unit="g"
        referenceLines={buildGoalReferenceLines(goals?.protein ?? null, "Goal")}
      />

      <MetricChart
        title="Saturated Fat"
        data={nutritionData}
        dataKey="saturatedFat"
        color="hsl(0, 84%, 60%)"
        unit="g"
        referenceLines={buildGoalReferenceLines(
          goals != null ? getSatFatGoalGrams(goals) : null,
          "Limit",
        )}
      />

      <MetricChart
        title="Fiber"
        data={nutritionData}
        dataKey="fiber"
        color="hsl(152, 76%, 42%)"
        unit="g"
        referenceLines={buildGoalReferenceLines(goals?.fiber ?? null, "Goal")}
      />

      <WeightChart
        data={weightData}
        canExtendToGoal={canExtendWeightToGoal}
        daysUntilGoal={daysUntilWeightGoal}
        extendToGoal={extendWeightToGoal && canExtendWeightToGoal}
        goalDate={weightGoalDate}
        onToggleExtendToGoal={() => setExtendWeightToGoal((value) => !value)}
      />
    </div>
  );
}
