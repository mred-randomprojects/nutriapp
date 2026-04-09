import { useNavigate } from "react-router-dom";
import { Plus, Pencil, Trash2 } from "lucide-react";
import type { AppDataHandle } from "../appDataType";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import type { FoodId } from "../types";

interface FoodListProps {
  appData: AppDataHandle;
}

export function FoodList({ appData }: FoodListProps) {
  const navigate = useNavigate();
  const { data, deleteFood } = appData;

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Foods</h1>
        <Button size="sm" onClick={() => navigate("/foods/new")}>
          <Plus className="mr-1 h-4 w-4" />
          Add Food
        </Button>
      </div>

      {data.foods.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <p>No foods yet. Add your first food to get started.</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {data.foods.map((food) => (
          <Card key={food.id}>
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
                <p className="truncate font-medium">{food.name}</p>
                <p className="text-xs text-muted-foreground">
                  {food.nutritionPer100g.calories} kcal ·{" "}
                  {food.nutritionPer100g.protein}g protein · per 100g
                </p>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => navigate(`/foods/${food.id}/edit`)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete "${food.name}"? This will also remove it from all logs.`,
                      )
                    ) {
                      deleteFood(food.id as FoodId);
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
