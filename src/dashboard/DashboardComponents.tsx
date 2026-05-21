import type React from "react";
import { AlertCircleIcon, CheckCircle2Icon, Loader2Icon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { feedbackKinds, type FeedbackKind } from "../shared/types.js";
import { feedbackKindLabels } from "./labels.js";
import type { FeedbackDraft } from "./types.js";

export function SectionCard(props: {
  readonly title: string;
  readonly description?: string;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <Card className={props.className}>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <CardTitle>{props.title}</CardTitle>
          {props.description === undefined ? null : (
            <CardDescription>{props.description}</CardDescription>
          )}
        </div>
        {props.action}
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </Card>
  );
}

export function MetricCard(props: {
  readonly label: string;
  readonly value: number | string;
  readonly tone?: "default" | "danger";
}) {
  return (
    <Card className={cn(props.tone === "danger" && "border-destructive/40")}>
      <CardContent className="pt-4">
        <div className="text-sm text-muted-foreground">{props.label}</div>
        <div className="mt-2 text-2xl font-semibold tracking-tight">{props.value}</div>
      </CardContent>
    </Card>
  );
}

export function TextField(props: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: React.HTMLInputTypeAttribute;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly description?: string;
}) {
  return (
    <Field>
      <FieldLabel>{props.label}</FieldLabel>
      <Input
        max={props.max}
        min={props.min}
        step={props.step}
        type={props.type ?? "text"}
        value={props.value}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
      />
      {props.description === undefined ? null : (
        <FieldDescription>{props.description}</FieldDescription>
      )}
    </Field>
  );
}

export function TextAreaField(props: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly description?: string;
}) {
  return (
    <Field>
      <FieldLabel>{props.label}</FieldLabel>
      <Textarea
        className="min-h-24"
        value={props.value}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
      />
      {props.description === undefined ? null : (
        <FieldDescription>{props.description}</FieldDescription>
      )}
    </Field>
  );
}

export function SelectField<TValue extends string>(props: {
  readonly label: string;
  readonly value: TValue;
  readonly options: readonly { readonly value: TValue; readonly label: string }[];
  readonly onChange: (value: TValue) => void;
  readonly description?: string;
}) {
  return (
    <Field>
      <FieldLabel>{props.label}</FieldLabel>
      <NativeSelect
        className="w-full"
        value={props.value}
        onChange={(event) => {
          props.onChange(event.target.value as TValue);
        }}
      >
        {props.options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {props.description === undefined ? null : (
        <FieldDescription>{props.description}</FieldDescription>
      )}
    </Field>
  );
}

export function ConfirmAction(props: {
  readonly label: string;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel?: string;
  readonly variant?: React.ComponentProps<typeof Button>["variant"];
  readonly disabled?: boolean;
  readonly pending?: boolean;
  readonly onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button disabled={props.disabled ?? props.pending} size="sm" variant={props.variant}>
          {props.pending === true ? <Loader2Icon className="animate-spin" /> : null}
          {props.label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>キャンセル</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              props.onConfirm();
            }}
          >
            {props.confirmLabel ?? props.label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function FeedbackForm(props: {
  readonly draft: FeedbackDraft;
  readonly disabled?: boolean;
  readonly onChange: (draft: FeedbackDraft) => void;
  readonly onSubmit: () => void;
}) {
  return (
    <FieldGroup className="gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <NativeSelect
          className="w-full sm:w-40"
          value={props.draft.feedbackKind}
          onChange={(event) => {
            props.onChange({
              ...props.draft,
              feedbackKind: event.target.value as FeedbackKind,
            });
          }}
        >
          {feedbackKinds.map((kind) => (
            <NativeSelectOption key={kind} value={kind}>
              {feedbackKindLabels[kind]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Input
          className="sm:w-56"
          placeholder="メモ任意"
          value={props.draft.note}
          onChange={(event) => {
            props.onChange({ ...props.draft, note: event.target.value });
          }}
        />
        <Button
          disabled={props.disabled}
          size="sm"
          type="button"
          variant="outline"
          onClick={props.onSubmit}
        >
          フィードバック
        </Button>
      </div>
    </FieldGroup>
  );
}

export function EmptyList(props: { readonly title: string; readonly description: string }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CheckCircle2Icon />
        </EmptyMedia>
        <EmptyTitle>{props.title}</EmptyTitle>
        <EmptyDescription>{props.description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function ErrorBanner(props: { readonly message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
      <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
      <span>{props.message}</span>
    </div>
  );
}

export function CountBadge(props: { readonly shown: number; readonly total: number }) {
  return (
    <Badge variant="outline">
      {props.shown} / {props.total}件
    </Badge>
  );
}
