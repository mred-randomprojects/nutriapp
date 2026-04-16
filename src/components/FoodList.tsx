import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import type { AppDataHandle } from "../appDataType";
import type { FoodId } from "../types";
import { isBuiltinFood } from "../data/builtinFoods";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { ConfirmDialog } from "./ConfirmDialog";
import type { PendingAction } from "./ConfirmDialog";

interface FoodListProps {
  appData: AppDataHandle;
}

export function FoodList({ appData }: FoodListProps) {
  const navigate = useNavigate();
  const { allFoods, deleteFood } = appData;
  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<PendingAction | null>(null);

  const filteredFoods = allFoods.filter((f) =>
    f.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Foods</h1>
        <Button size="sm" onClick={() => navigate("/foods/new")}>
          <Plus className="mr-1 h-4 w-4" />
          Add Food
        </Button>
      </div>

      {allFoods.length > 0 && (
        <Input
          placeholder="Search foods..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-4"
        />
      )}

      {allFoods.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <p>No foods yet. Add your first food to get started.</p>
          </CardContent>
        </Card>
      )}

      {filteredFoods.length === 0 && allFoods.length > 0 && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            No foods match &ldquo;{search}&rdquo;
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {filteredFoods.map((food) => {
          const builtin = isBuiltinFood(food.id);
          return (
            <Card
              key={food.id}
              className="cursor-pointer transition-colors hover:bg-accent/50"
              onClick={() => navigate(`/foods/${food.id}/edit`)}
            >
              <CardContent className="flex items-center gap-3 p-3">
                {food.imageUrl != null ? (
                  <img
                    src={food.imageUrl}
                    alt={food.name}
                    className="h-12 w-12 rounded-lg object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-secondary text-lg">
                    🍽️
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate font-medium">{food.name}</p>
                    {builtin && (
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        built-in
                      </Badge>
                    )}
                    {food.ingredients != null && (
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        combo
                      </Badge>
                    )}
                    {food.nutritionPerUnit != null && (
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        unit-based
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {food.nutritionPerUnit != null
                      ? `${food.nutritionPerUnit.calories} kcal · ${food.nutritionPerUnit.protein}g protein · per unit`
                      : `${food.nutritionPer100g.calories} kcal · ${food.nutritionPer100g.protein}g protein`}
                    {food.nutritionPerUnit == null && food.ingredients != null ? (
                      <>
                        {" · "}
                        {food.ingredients.length} ingredient
                        {food.ingredients.length !== 1 && "s"}
                        {food.gramsPerUnit != null &&
                          ` · ${food.gramsPerUnit}g/serving`}
                      </>
                    ) : food.nutritionPerUnit == null ? (
                      <>
                        {" · per 100g"}
                        {food.gramsPerUnit != null &&
                          ` · ${food.gramsPerUnit}g/unit`}
                      </>
                    ) : null}
                  </p>
                </div>
                {!builtin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDelete({
                        title: "Delete food",
                        description: `Delete "${food.name}"? This will also remove it from all logs.`,
                        onConfirm: () => deleteFood(food.id as FoodId),
                      });
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <ConfirmDialog
        pending={pendingDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
