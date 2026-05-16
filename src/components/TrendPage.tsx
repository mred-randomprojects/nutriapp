import { useState, useMemo, type ReactNode } from "react";
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
import type { TooltipContentProps, TooltipValueType } from "recharts";
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
import { KCAL_PER_KG, computeExpectedWeight, computeTdee } from "../calculator";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";

type TimeRange = "7d" | "30d" | "90d" | "all";
type CalorieComparisonTarget = "maintenance" | "goal";

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
  interpolatedWeight: number | null;
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
  excludedDate: string | null,
): NutritionDataPoint[] {
  const cutoffDate = getRangeCutoffDate(range);

  const points: NutritionDataPoint[] = [];

  for (const dl of dayLogs) {
    if (dl.date === excludedDate) continue;
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
  excludedDate: string | null,
): WeightDataPoint[] {
  const cutoffDate = getRangeCutoffDate(range);
  const cutoffKey = cutoffDate != null ? formatDateKey(cutoffDate) : null;
  const currentEndDate =
    excludedDate != null ? subDays(parseISO(excludedDate), 1) : new Date();
  const currentEndKey = formatDateKey(currentEndDate);

  const weightsByDate = new Map<string, number>();

  for (const dl of dayLogs) {
    if (dl.date === excludedDate) continue;
    if (dl.weightKg == null) continue;
    weightsByDate.set(dl.date, dl.weightKg);
  }

  const actualDates = Array.from(weightsByDate.keys()).sort((a, b) =>
    a.localeCompare(b),
  );
  const visibleActualDates = actualDates.filter(
    (date) => cutoffKey == null || date.localeCompare(cutoffKey) >= 0,
  );
  const goalDate =
    extendToGoalDate && weightLossPlan != null
      ? getWeightPlanGoalDate(weightLossPlan)
      : null;
  const firstActualDate = actualDates[0] ?? null;
  const latestVisibleActualDate = getLatestDateKey(visibleActualDates);
  const firstExpectedDate =
    weightLossPlan != null ? weightLossPlan.startDate : null;
  const startDateKey =
    cutoffKey ?? getEarliestDateKey([firstActualDate, firstExpectedDate]);
  const endDateKey = getLatestDateKey([
    currentEndKey,
    latestVisibleActualDate,
    goalDate,
  ]);

  if (
    startDateKey == null ||
    endDateKey == null ||
    startDateKey.localeCompare(endDateKey) > 0
  ) {
    return [];
  }

  const points: WeightDataPoint[] = [];
  let currentDate = parseISO(startDateKey);
  const endDate = parseISO(endDateKey);

  while (currentDate <= endDate) {
    const date = formatDateKey(currentDate);
    if (date !== excludedDate) {
      points.push({
        date,
        label: format(currentDate, "MMM d"),
        weight: weightsByDate.get(date) ?? null,
        interpolatedWeight: null,
        expected:
          weightLossPlan != null ? computeExpectedWeight(weightLossPlan, date) : null,
      });
    }

    currentDate = addDays(currentDate, 1);
  }

  if (actualDates.length >= 2) {
    for (const point of points) {
      const actualWeight = weightsByDate.get(point.date);
      if (actualWeight != null) {
        point.interpolatedWeight = actualWeight;
        continue;
      }

      const nextActualIndex = actualDates.findIndex(
        (date) => date.localeCompare(point.date) > 0,
      );
      if (nextActualIndex <= 0) continue;

      const previousDate = actualDates[nextActualIndex - 1];
      const nextDate = actualDates[nextActualIndex];
      const previousWeight = weightsByDate.get(previousDate);
      const nextWeight = weightsByDate.get(nextDate);
      if (previousWeight == null || nextWeight == null) continue;

      const totalDays = differenceInCalendarDays(
        parseISO(nextDate),
        parseISO(previousDate),
      );
      const elapsedDays = differenceInCalendarDays(
        parseISO(point.date),
        parseISO(previousDate),
      );
      if (totalDays <= 0 || elapsedDays <= 0 || elapsedDays >= totalDays) {
        continue;
      }

      point.interpolatedWeight =
        previousWeight + ((nextWeight - previousWeight) * elapsedDays) / totalDays;
    }
  }

  const hasVisibleWeightData = points.some(
    (point) =>
      point.weight != null ||
      point.interpolatedWeight != null ||
      point.expected != null,
  );

  return hasVisibleWeightData ? points : [];
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

function getEarliestDateKey(dates: ReadonlyArray<string | null>): string | null {
  let earliestDate: string | null = null;

  for (const date of dates) {
    if (date == null) continue;
    if (earliestDate == null || date.localeCompare(earliestDate) < 0) {
      earliestDate = date;
    }
  }

  return earliestDate;
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

function formatMetricValue(value: number, unit: string): string {
  if (unit.trim() === "kcal") {
    return `${Math.round(value)}${unit}`;
  }

  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}${unit}`;
}

function formatSignedKcal(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded} kcal`;
}

function formatSignedKg(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)} kg`;
}

function getCalorieComparisonValue(
  target: CalorieComparisonTarget,
  goalValue: number | null,
  maintenanceValue: number | null,
): number | null {
  return target === "maintenance" ? maintenanceValue : goalValue;
}

function getAvailableCalorieComparisonTargets(
  goalValue: number | null,
  maintenanceValue: number | null,
): CalorieComparisonTarget[] {
  const targets: CalorieComparisonTarget[] = [];
  if (maintenanceValue != null) targets.push("maintenance");
  if (goalValue != null) targets.push("goal");
  return targets;
}

function getCalorieComparisonLabel(target: CalorieComparisonTarget): string {
  return target === "maintenance" ? "Maintenance" : "Goal";
}

function getPeriodCalorieDelta(
  data: NutritionDataPoint[],
  comparisonValue: number | null,
): number | null {
  if (comparisonValue == null || data.length === 0) return null;

  return data.reduce(
    (total, point) => total + (point.calories - comparisonValue),
    0,
  );
}

function getExpectedWeightDelta(calorieDelta: number | null): number | null {
  return calorieDelta != null ? calorieDelta / KCAL_PER_KG : null;
}

function getActualWeightDelta(data: WeightDataPoint[]): number | null {
  const actualWeights = data.filter(
    (point): point is WeightDataPoint & { weight: number } =>
      point.weight != null,
  );

  if (actualWeights.length < 2) return null;

  return (
    actualWeights[actualWeights.length - 1].weight - actualWeights[0].weight
  );
}

function formatDaysRemaining(days: number): string {
  return days === 1 ? "1 day remaining" : `${days} days remaining`;
}

interface MetricTooltipProps
  extends TooltipContentProps<TooltipValueType, string | number> {
  title: string;
  unit: string;
  referenceLines: MetricReferenceLine[];
}

function getTooltipValue(value: TooltipValueType | undefined): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function MetricTooltip({
  active,
  payload,
  label,
  title,
  unit,
  referenceLines,
}: MetricTooltipProps) {
  if (!active || payload.length === 0) return null;

  const value = getTooltipValue(payload[0]?.value);
  if (value == null) return null;

  return (
    <div
      className="rounded-lg border border-[hsl(240,10%,18%)] bg-[hsl(240,12%,8%)] px-3 py-2 text-xs text-[hsl(210,20%,95%)] shadow-lg"
      style={{ minWidth: 140 }}
    >
      <p className="mb-1 text-[11px] text-muted-foreground">{label}</p>
      <p>
        <span className="text-muted-foreground">{title}:</span>{" "}
        <span className="font-medium">{formatMetricValue(value, unit)}</span>
      </p>
      {referenceLines.map((line) => (
        <p key={`${line.label}-${line.value}`} style={{ color: line.stroke }}>
          {line.label}: {formatMetricValue(line.value, unit)}
        </p>
      ))}
    </div>
  );
}

function WeightTooltip({
  active,
  payload,
  label,
}: TooltipContentProps<TooltipValueType, string | number>) {
  if (!active || payload.length === 0) return null;

  const point = payload[0]?.payload as WeightDataPoint | undefined;
  if (point == null) return null;

  const measured = point.weight;
  const interpolated = point.interpolatedWeight;
  const expected = point.expected;

  if (measured == null && interpolated == null && expected == null) {
    return null;
  }

  return (
    <div
      className="rounded-lg border border-[hsl(240,10%,18%)] bg-[hsl(240,12%,8%)] px-3 py-2 text-xs text-[hsl(210,20%,95%)] shadow-lg"
      style={{ minWidth: 160 }}
    >
      <p className="mb-1 text-[11px] text-muted-foreground">{label}</p>
      {measured != null ? (
        <p>
          <span className="text-muted-foreground">Measured:</span>{" "}
          <span className="font-medium">{measured.toFixed(1)} kg</span>
        </p>
      ) : interpolated != null ? (
        <p>
          <span className="text-muted-foreground">Interpolated:</span>{" "}
          <span className="font-medium">{interpolated.toFixed(1)} kg</span>
        </p>
      ) : (
        <p className="text-muted-foreground">No weigh-in logged</p>
      )}
      {expected != null && (
        <p style={{ color: "hsl(215, 15%, 65%)" }}>
          Expected: {expected.toFixed(1)} kg
        </p>
      )}
    </div>
  );
}

interface MetricChartProps {
  title: string;
  data: NutritionDataPoint[];
  dataKey: string;
  color: string;
  unit: string;
  referenceLines?: MetricReferenceLine[];
  headerMeta?: ReactNode;
  headerAction?: ReactNode;
}

function MetricChart({
  title,
  data,
  dataKey,
  color,
  unit,
  referenceLines = [],
  headerMeta,
  headerAction,
}: MetricChartProps) {
  const header =
    headerMeta != null || headerAction != null ? (
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>{title}</CardTitle>
          {headerMeta}
        </div>
        {headerAction}
      </CardHeader>
    ) : (
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
    );

  if (data.length === 0) {
    return (
      <Card className="mb-4">
        {header}
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
              content={(props) => (
                <MetricTooltip
                  {...props}
                  title={title}
                  unit={unit}
                  referenceLines={referenceLines}
                />
              )}
            />
            {referenceLines.map((line) => (
              <ReferenceLine
                key={`${line.label}-${line.value}`}
                y={line.value}
                stroke={line.stroke}
                strokeDasharray={line.strokeDasharray}
                label={{
                  value: `${line.label}: ${formatMetricValue(
                    line.value,
                    unit,
                  )}`,
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
  const hasInterpolated = data.some(
    (d) => d.weight == null && d.interpolatedWeight != null,
  );
  const hasTrend = data.some((d) => d.interpolatedWeight != null);
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
            <Tooltip content={(props) => <WeightTooltip {...props} />} />
            {hasTrend && hasInterpolated && (
              <Line
                type="linear"
                dataKey="interpolatedWeight"
                stroke="hsl(152, 76%, 42%)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                activeDot={false}
                connectNulls={false}
              />
            )}
            <Line
              type="linear"
              dataKey="weight"
              stroke="hsl(152, 76%, 42%)"
              strokeWidth={hasInterpolated ? 0 : 2}
              dot={{ r: 3, fill: "hsl(152, 76%, 42%)" }}
              activeDot={{ r: 5, fill: "hsl(152, 76%, 42%)" }}
              connectNulls={false}
            />
            {hasExpected && (
              <Line
                type="linear"
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
        {(hasActual || hasInterpolated || hasExpected) && (
          <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
            {hasActual && (
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: "hsl(152, 76%, 42%)" }}
                />
                Measured
              </span>
            )}
            {hasInterpolated && (
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-0.5 w-4 rounded border-t border-dashed"
                  style={{ borderColor: "hsl(152, 76%, 42%)" }}
                />
                Interpolated
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
  const [excludeToday, setExcludeToday] = useState(false);
  const [calorieComparisonTarget, setCalorieComparisonTarget] =
    useState<CalorieComparisonTarget>("maintenance");
  const [extendWeightToGoal, setExtendWeightToGoal] = useState(true);
  const excludedDate = excludeToday ? formatDateKey(new Date()) : null;

  const nutritionData = useMemo(() => {
    if (activeProfile == null) return [];
    return buildNutritionData(
      activeProfile.dayLogs,
      foodsMap,
      range,
      excludedDate,
    );
  }, [activeProfile, excludedDate, foodsMap, range]);

  const weightData = useMemo(() => {
    if (activeProfile == null) return [];
    return buildWeightData(
      activeProfile.dayLogs,
      activeProfile.weightLossPlan ?? null,
      range,
      extendWeightToGoal,
      excludedDate,
    );
  }, [activeProfile, excludedDate, extendWeightToGoal, range]);

  const goals = activeProfile?.goals ?? null;
  const maintenanceCalories = getMaintenanceCalories(
    activeProfile?.userMetrics ?? null,
  );
  const calorieGoal = goals?.calories ?? null;
  const availableCalorieComparisonTargets = getAvailableCalorieComparisonTargets(
    calorieGoal,
    maintenanceCalories,
  );
  const selectedCalorieComparisonTarget =
    availableCalorieComparisonTargets.includes(calorieComparisonTarget)
      ? calorieComparisonTarget
      : availableCalorieComparisonTargets[0] ?? "maintenance";
  const selectedCalorieComparisonValue = getCalorieComparisonValue(
    selectedCalorieComparisonTarget,
    calorieGoal,
    maintenanceCalories,
  );
  const periodCalorieDelta = getPeriodCalorieDelta(
    nutritionData,
    selectedCalorieComparisonValue,
  );
  const maintenanceCalorieDelta = getPeriodCalorieDelta(
    nutritionData,
    maintenanceCalories,
  );
  const expectedWeightDelta = getExpectedWeightDelta(maintenanceCalorieDelta);
  const actualWeightDelta = getActualWeightDelta(weightData);
  const selectedCalorieComparisonLabel = getCalorieComparisonLabel(
    selectedCalorieComparisonTarget,
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

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex flex-1 gap-1">
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
        <Button
          type="button"
          size="sm"
          variant={excludeToday ? "secondary" : "outline"}
          className="h-8 text-xs"
          aria-pressed={excludeToday}
          onClick={() => setExcludeToday((value) => !value)}
        >
          Exclude today
        </Button>
      </div>

      <MetricChart
        title="Calories"
        data={nutritionData}
        dataKey="calories"
        color="hsl(45, 93%, 58%)"
        unit=" kcal"
        referenceLines={buildCalorieReferenceLines(
          calorieGoal,
          maintenanceCalories,
        )}
        headerMeta={
          periodCalorieDelta != null ? (
            <div className="mt-1 space-y-0.5 text-xs">
              <p
                className={
                  periodCalorieDelta > 0
                    ? "text-red-500"
                    : periodCalorieDelta < 0
                      ? "text-emerald-500"
                      : "text-muted-foreground"
                }
              >
                Period delta vs {selectedCalorieComparisonLabel.toLowerCase()}:{" "}
                {formatSignedKcal(periodCalorieDelta)}
              </p>
              {expectedWeightDelta != null && (
                <p className="text-muted-foreground">
                  Expected weight delta vs maintenance:{" "}
                  {formatSignedKg(expectedWeightDelta)}
                  {actualWeightDelta != null &&
                    ` | Actual: ${formatSignedKg(actualWeightDelta)}`}
                </p>
              )}
            </div>
          ) : null
        }
        headerAction={
          availableCalorieComparisonTargets.length > 1 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shrink-0 px-2.5 text-xs"
              onClick={() =>
                setCalorieComparisonTarget(
                  selectedCalorieComparisonTarget === "maintenance"
                    ? "goal"
                    : "maintenance",
                )
              }
            >
              Compare: {selectedCalorieComparisonLabel}
            </Button>
          ) : null
        }
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
          "Goal",
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
