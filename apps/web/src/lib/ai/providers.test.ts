import { describe, expect, it } from "vitest";
import { toGeminiSchema } from "@/lib/ai/providers";

describe("toGeminiSchema — canonical JSON Schema -> Gemini responseSchema dialect", () => {
  it("uppercases primitive types", () => {
    expect(toGeminiSchema({ type: "string" })).toEqual({ type: "STRING" });
    expect(toGeminiSchema({ type: "number" })).toEqual({ type: "NUMBER" });
    expect(toGeminiSchema({ type: "boolean" })).toEqual({ type: "BOOLEAN" });
  });

  it("converts a [type, null] union to nullable + the non-null uppercase type", () => {
    expect(toGeminiSchema({ type: ["string", "null"], description: "x" })).toEqual({
      type: "STRING",
      nullable: true,
      description: "x",
    });
  });

  it("drops additionalProperties and strict — not part of the Gemini dialect", () => {
    const result = toGeminiSchema({
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a"],
      additionalProperties: false,
    });
    expect(result).not.toHaveProperty("additionalProperties");
    expect(result).not.toHaveProperty("strict");
  });

  it("emits propertyOrdering from canonical key order and preserves required", () => {
    const result = toGeminiSchema({
      type: "object",
      properties: {
        b: { type: "string" },
        a: { type: "number" },
      },
      required: ["b"],
    });
    expect(result.propertyOrdering).toEqual(["b", "a"]);
    expect(result.required).toEqual(["b"]);
  });

  it("translates array items recursively", () => {
    const result = toGeminiSchema({
      type: "array",
      items: { type: ["string", "null"] },
    });
    expect(result).toEqual({ type: "ARRAY", items: { type: "STRING", nullable: true } });
  });

  it("strips a null member out of enum and marks nullable", () => {
    const result = toGeminiSchema({
      type: ["string", "null"],
      enum: ["a", "b", null],
    });
    expect(result.enum).toEqual(["a", "b"]);
    expect(result.nullable).toBe(true);
  });

  // Regression guard for the recipe decoding-stability fix (parser.ts):
  // the translator must reproduce the exact propertyOrdering/required that
  // shipped before this ticket, or constrained decoding can degenerate.
  it("reproduces the recipe schema's exact propertyOrdering and partial required", () => {
    const recipeSchema = {
      type: "object",
      properties: {
        title: { type: "string" },
        ingredients: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              item: { type: "string" },
              quantity: { type: "number" },
              unit: { type: "string" },
            },
            required: ["name", "item"],
          },
        },
        steps: { type: "array", items: { type: "string" } },
        servings: { type: "number" },
        prep_minutes: { type: "number" },
        cook_minutes: { type: "number" },
      },
      required: ["title", "ingredients", "steps"],
    };

    const result = toGeminiSchema(recipeSchema);

    expect(result.propertyOrdering).toEqual([
      "title",
      "ingredients",
      "steps",
      "servings",
      "prep_minutes",
      "cook_minutes",
    ]);
    expect(result.required).toEqual(["title", "ingredients", "steps"]);

    const ingredients = (result.properties as Record<string, Record<string, unknown>>).ingredients;
    const ingredientItem = ingredients.items as Record<string, unknown>;
    expect(ingredientItem.propertyOrdering).toEqual(["name", "item", "quantity", "unit"]);
    expect(ingredientItem.required).toEqual(["name", "item"]);
  });
});
