"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { DEFAULT_TEST, type EditorCondition, type EditorTest } from "../../editor-model";
import { fill } from "../../i18n";
import { findPropertyOption, operatorsForKind, propertyOptions } from "../../picker-options";
import { PropertyPicker } from "../pickers/property-picker";
import { hintClass, type StepEditorContext } from "./types";

/** One or more tests on the run's values, with the property picker (U10). */
export function ConditionFields({
  prefix,
  when,
  onChange,
  ctx,
}: {
  prefix: string;
  when: EditorCondition;
  onChange: (when: EditorCondition) => void;
  ctx: StepEditorContext;
}) {
  const { m } = ctx;
  const groups = propertyOptions(ctx.catalog, ctx.objectTypes, ctx.locale);
  const setTest = (index: number, test: EditorTest) =>
    onChange({ ...when, tests: when.tests.map((existing, position) => (position === index ? test : existing)) });

  return (
    <div className="space-y-3">
      {when.tests.length > 1 ? (
        <div className="sm:w-64">
          <Label htmlFor={`${prefix}-match`}>{m.steps.match}</Label>
          <Select id={`${prefix}-match`} value={when.match}
            onChange={(event) => onChange({ ...when, match: event.target.value as EditorCondition["match"] })}>
            <option value="all">{m.steps.matchAll}</option>
            <option value="any">{m.steps.matchAny}</option>
          </Select>
        </div>
      ) : null}
      {when.tests.map((test, index) => {
        const testPrefix = when.tests.length > 1 ? `${prefix}-t${index + 1}` : prefix;
        const option = findPropertyOption(groups, test.path);
        const offered = operatorsForKind(option?.kind);
        // A saved operator the property's kind does not offer stays shown, so the list never misstates the test.
        const operators = offered.includes(test.op) ? offered : [...offered, test.op];
        const listId = `${testPrefix}-choices`;
        const needsValue = test.op !== "is_empty" && test.op !== "is_not_empty";
        return (
          <fieldset key={index} className="grid gap-3 sm:grid-cols-3">
            {when.tests.length > 1 ? (
              <legend className="mb-1 flex w-full items-center justify-between text-[13px] font-medium text-ink">
                {fill(m.steps.testLabel, { number: index + 1 })}
                <Button type="button" variant="ghost" size="sm" aria-label={fill(m.steps.removeTest, { number: index + 1 })}
                  onClick={() => onChange({ ...when, tests: when.tests.filter((_, position) => position !== index) })}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </legend>
            ) : null}
            <PropertyPicker
              id={`${testPrefix}-property`}
              value={test.path}
              catalog={ctx.catalog}
              objectTypes={ctx.objectTypes}
              locale={ctx.locale}
              m={m}
              onChange={(path, picked) => {
                const allowed = operatorsForKind(picked?.kind);
                setTest(index, { ...test, path, op: allowed.includes(test.op) ? test.op : allowed[0] });
              }}
            />
            <div>
              <Label htmlFor={`${testPrefix}-op`}>{m.steps.operator}</Label>
              <Select id={`${testPrefix}-op`} value={test.op}
                onChange={(event) => setTest(index, { ...test, op: event.target.value as EditorTest["op"] })}>
                {operators.map((op) => <option key={op} value={op}>{m.operators[op]}</option>)}
              </Select>
            </div>
            {needsValue ? (
              <div>
                <Label htmlFor={`${testPrefix}-value`}>{m.steps.value}</Label>
                <Input id={`${testPrefix}-value`} value={test.value} aria-describedby={`${testPrefix}-value-hint`}
                  list={option && option.choices.length ? listId : undefined}
                  onChange={(event) => setTest(index, { ...test, value: event.target.value })} />
                {option && option.choices.length ? (
                  <datalist id={listId}>
                    {option.choices.map((choice) => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
                  </datalist>
                ) : null}
                <p id={`${testPrefix}-value-hint`} className={hintClass}>{m.steps.valueHint}</p>
              </div>
            ) : null}
          </fieldset>
        );
      })}
      <Button type="button" variant="ghost" size="sm"
        onClick={() => onChange({ ...when, tests: [...when.tests, { ...DEFAULT_TEST }] })}>
        {m.steps.addTest}
      </Button>
    </div>
  );
}
