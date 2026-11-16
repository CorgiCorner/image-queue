"use client";
import { useRef } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
export type SelectOption = { value: string; label: string; disabled?: boolean };
export function SelectInput({
  id,
  label,
  value,
  onValueChange,
  options,
  placeholder,
  className,
  contentClassName,
  disabled,
  side = "top",
  deferValue,
}: {
  id?: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  contentClassName?: string;
  disabled?: boolean;
  side?: "top" | "bottom";
  deferValue?: string;
}) {
  const deferred = useRef<string | null>(null);
  const emptyOption = "__image_queue_empty__";
  const choices = options.map(option => ({...option,value:option.value || emptyOption}));
  return (
    <Select
      value={value || (options.some(option=>option.value === "") ? emptyOption : null)}
      items={choices}
      disabled={disabled || choices.length === 0}
      onValueChange={(next) => {
        if (next === null) return;
        if (next === deferValue) deferred.current = next;
        else onValueChange(next === emptyOption ? "" : next);
      }}
      onOpenChangeComplete={(open) => {
        if (open || deferred.current === null) return;
        const next = deferred.current;
        deferred.current = null;
        onValueChange(next);
      }}
    >
      <SelectTrigger id={id} aria-label={label} className={className} size="sm">
        <SelectValue
          placeholder={
            placeholder ?? options.find((option) => option.value === "")?.label
          }
        />
      </SelectTrigger>
      <SelectContent className={contentClassName} side={side} align="start" alignItemWithTrigger={false}>
        {choices.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
