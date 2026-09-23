// Visual language for the Farmer File's five documents: small status dots on
// the farmers list, and the state colours the file page's section headers
// reuse. Same palette as the chain flow / stage guide.

import type { DocState, DocStatus } from "@/lib/farmer-file-core";
import { useI18n, type I18nKey } from "@/lib/i18n";

export const DOC_TITLE_KEY: Record<DocStatus["key"], I18nKey> = {
  bio: "ff.bio",
  purchase: "ff.purchase",
  lending: "ff.lending",
  receipts: "ff.receipts",
  testing: "ff.testing",
};

export const docStateClass: Record<DocState, string> = {
  done: "bg-primary text-primary-foreground",
  attention: "bg-destructive text-destructive-foreground",
  current: "bg-chart-4 text-white ring-2 ring-chart-4/25",
  pending: "bg-muted text-muted-foreground",
  na: "bg-muted text-muted-foreground/50",
};

export function DocDots({ docs }: { docs: DocStatus[] }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1">
      {docs.map((d, i) => (
        <span
          key={d.key}
          title={`${i + 1}. ${t(DOC_TITLE_KEY[d.key])} — ${d.detail}`}
          className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold leading-none ${docStateClass[d.state]}`}
        >
          {d.state === "na" ? "–" : i + 1}
        </span>
      ))}
    </div>
  );
}
