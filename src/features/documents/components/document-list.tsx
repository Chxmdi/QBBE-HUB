"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import {
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  History,
  Image as ImageIcon,
  Link2,
  Paperclip,
  Presentation,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Menu } from "@/components/ui/menu";
import {
  DataTable,
  SortableHeader,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useSort,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import {
  archiveDocument,
  getDocumentDownloadUrl,
  restoreDocument,
} from "@/features/documents/services/document.commands";
import { useFormatters, useT } from "@/lib/i18n/client";
import type { Formatters } from "@/lib/i18n/format";
import type { TranslateFn } from "@/lib/i18n/translate";
import { folderLabel, type LibraryFolder } from "@/features/documents/services/library";
import { SearchSnippet } from "@/features/documents/components/search-snippet";

export interface DocumentRow {
  id: string;
  title: string;
  description: string | null;
  kind: "file" | "link";
  mime_type: string | null;
  size_bytes: number | null;
  scan_status: "pending" | "clean" | "quarantined" | "rejected";
  visibility: string;
  created_at: string;
  owner: { full_name: string } | null;
  project: { id: string; name: string } | null;
  program: { id: string; name: string } | null;
  folder: Pick<LibraryFolder, "id" | "category" | "name" | "visibility"> | null;
  tags: string[];
  version_number: number;
  requires_acknowledgement: boolean;
}

/** File-type icon from the MIME type, falling back safely (§10.15). */
function DocumentIcon({ doc }: { doc: DocumentRow }) {
  if (doc.kind === "link") return <Link2 className="size-4" aria-hidden />;
  const mime = doc.mime_type ?? "";
  if (mime.startsWith("image/")) return <ImageIcon className="size-4" aria-hidden />;
  if (mime.includes("sheet") || mime.includes("csv") || mime.includes("excel"))
    return <FileSpreadsheet className="size-4" aria-hidden />;
  if (mime.includes("presentation") || mime.includes("powerpoint"))
    return <Presentation className="size-4" aria-hidden />;
  if (mime.includes("pdf") || mime.includes("word") || mime.startsWith("text/"))
    return <FileText className="size-4" aria-hidden />;
  return <Paperclip className="size-4" aria-hidden />;
}

function formatSize(bytes: number | null, t: TranslateFn, format: Formatters): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return t("documents.size.bytes", { size: format.number(bytes) });
  if (bytes < 1024 * 1024) {
    return t("documents.size.kilobytes", { size: format.number(Math.round(bytes / 1024)) });
  }
  return t("documents.size.megabytes", {
    size: format.number(bytes / (1024 * 1024), { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  });
}

export function DocumentList({
  documents,
  canManage,
  highlightId = null,
  archived = false,
  snippets,
}: {
  documents: DocumentRow[];
  canManage: boolean;
  /** Search passages found inside files, by document id (#147). */
  snippets?: Record<string, string>;
  /** Deep-linked from search: this row is anchored and marked. */
  highlightId?: string | null;
  archived?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const format = useFormatters();
  const [busyId, setBusyId] = useState<string | null>(null);

  const { sorted, sortKey, direction, onSort } = useSort<DocumentRow>(
    documents,
    {
      title: (d) => d.title.toLowerCase(),
      context: (d) => d.project?.name ?? d.program?.name ?? "",
      owner: (d) => d.owner?.full_name ?? "",
      created_at: (d) => d.created_at,
    },
    "created_at",
  );

  async function open(doc: DocumentRow) {
    setBusyId(doc.id);
    const result = await getDocumentDownloadUrl(doc.id);
    setBusyId(null);
    if (!result.ok || !result.url) {
      toast(result.error ?? t("documents.list.openFailed"), { tone: "error" });
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  async function restore(doc: DocumentRow) {
    const result = await restoreDocument(doc.id);
    if (result.ok) {
      toast(t("documents.list.restored"));
      router.refresh();
    } else {
      toast(result.error ?? t("documents.list.restoreFailed"), { tone: "error" });
    }
  }

  async function archive(doc: DocumentRow) {
    if (!window.confirm(t("documents.list.confirmArchive", { title: doc.title }))) return;
    const result = await archiveDocument(doc.id);
    if (result.ok) {
      toast(t("documents.list.archivedToast"));
      router.refresh();
    } else {
      toast(result.error ?? t("documents.list.archiveFailed"), { tone: "error" });
    }
  }

  return (
    <DataTable minWidth="820px">
      <TableHead>
        <SortableHeader
          label={t("documents.list.name")}
          sortKey="title"
          activeKey={sortKey}
          direction={direction}
          onSort={onSort}
        />
        <SortableHeader
          label={t("documents.list.context")}
          sortKey="context"
          activeKey={sortKey}
          direction={direction}
          onSort={onSort}
        />
        <SortableHeader
          label={t("documents.list.owner")}
          sortKey="owner"
          activeKey={sortKey}
          direction={direction}
          onSort={onSort}
        />
        <TableHeader>{t("documents.list.access")}</TableHeader>
        <SortableHeader
          label={t("documents.list.added")}
          sortKey="created_at"
          activeKey={sortKey}
          direction={direction}
          onSort={onSort}
        />
        <TableHeader className="w-10">
          <span className="sr-only">{t("documents.list.actions")}</span>
        </TableHeader>
      </TableHead>
      <tbody>
        {sorted.map((doc) => {
          const fileUnavailable = doc.kind === "file" && doc.scan_status !== "clean";
          const scanLabel = doc.kind !== "file"
            ? null
            : doc.scan_status === "pending"
              ? t("documents.list.scanPending")
              : doc.scan_status === "quarantined"
                ? t("documents.list.quarantined")
                : doc.scan_status === "rejected"
                  ? t("documents.list.rejected")
                  : null;
          return (
            <TableRow
              key={doc.id}
              id={`document-${doc.id}`}
              // A tint rather than aria-selected: this is a static table, not a
              // grid, and nothing here is selectable.
              className={doc.id === highlightId ? "bg-brand-soft/40" : undefined}
            >
              <TableCell>
                <button
                  type="button"
                  onClick={() => open(doc)}
                  disabled={busyId === doc.id || fileUnavailable}
                  title={scanLabel ?? undefined}
                  aria-describedby={scanLabel ? `document-scan-${doc.id}` : undefined}
                  className="flex items-start gap-2.5 text-left hover:text-brand-fg disabled:opacity-60"
                >
                  <span className="mt-0.5 text-muted">
                    <DocumentIcon doc={doc} />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium">{doc.title}</span>
                    {doc.description ? (
                      <span className="meta block max-w-md truncate">
                        {doc.description}
                      </span>
                    ) : null}
                    {snippets?.[doc.id] ? <SearchSnippet snippet={snippets[doc.id]} /> : null}
                    <span className="meta">
                      {doc.kind === "link"
                        ? t("documents.list.externalLink")
                        : formatSize(doc.size_bytes, t, format)}
                      {doc.version_number > 1
                        ? t("documents.versionSuffix", { number: doc.version_number })
                        : ""}
                    </span>
                  </span>
                </button>
                {doc.tags.length || doc.requires_acknowledgement ? (
                  <div className="mt-1 flex flex-wrap gap-1 pl-6.5">
                    {doc.requires_acknowledgement ? (
                      <Badge tone="info">{t("documents.list.requiredReading")}</Badge>
                    ) : null}
                    {doc.tags.map((tag) => (
                      <Link
                        key={tag}
                        href={`/documents?tag=${encodeURIComponent(tag)}`}
                        className="rounded-full bg-surface-soft px-2 py-0.5 text-[12px] text-muted hover:text-brand-fg"
                      >
                        #{tag}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </TableCell>
              <TableCell className="text-muted">
                {doc.project ? (
                  <Link
                    href={`/projects/${doc.project.id}`}
                    className="hover:text-brand-fg hover:underline"
                  >
                    {doc.project.name}
                  </Link>
                ) : doc.program ? (
                  <Link
                    href={`/programs/${doc.program.id}`}
                    className="hover:text-brand-fg hover:underline"
                  >
                    {doc.program.name}
                  </Link>
                ) : doc.folder ? (
                  <Link
                    href={`/documents?folder=${doc.folder.id}`}
                    className="hover:text-brand-fg hover:underline"
                  >
                    {folderLabel(doc.folder, t)}
                  </Link>
                ) : (
                  t("documents.list.general")
                )}
                {(doc.project || doc.program) && doc.folder ? (
                  <span className="meta block">{folderLabel(doc.folder, t)}</span>
                ) : null}
              </TableCell>
              <TableCell className="text-muted">
                {doc.owner?.full_name ?? "—"}
              </TableCell>
              <TableCell>
                <Badge tone={doc.visibility === "staff" ? "accent" : "neutral"}>
                  {doc.visibility === "staff"
                    ? t("documents.list.staffOnly")
                    : t("documents.list.allMembers")}
                </Badge>
                {scanLabel ? (
                  <span id={`document-scan-${doc.id}`}>
                    <Badge
                      tone={doc.scan_status === "pending" ? "warning" : "danger"}
                      className="ml-1"
                    >
                      {scanLabel}
                    </Badge>
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted">
                {format.date(doc.created_at)}
              </TableCell>
              <TableCell>
                <Menu
                  label={t("documents.list.actionsFor", { title: doc.title })}
                  items={[
                    {
                      label:
                        doc.kind === "link"
                          ? t("documents.list.openLink")
                          : t("documents.list.download"),
                      onSelect: () => open(doc),
                      disabled: fileUnavailable,
                      icon:
                        doc.kind === "link" ? (
                          <ExternalLink className="size-4" aria-hidden />
                        ) : (
                          <Download className="size-4" aria-hidden />
                        ),
                    },
                    {
                      label: t("documents.list.detailsAndVersions"),
                      onSelect: () => router.push(`/documents/${doc.id}`),
                      icon: <History className="size-4" aria-hidden />,
                    },
                    ...(canManage
                      ? [
                          {
                            label: archived ? t("documents.list.restore") : t("documents.list.archive"),
                            onSelect: () => (archived ? restore(doc) : archive(doc)),
                            destructive: !archived,
                          },
                        ]
                      : []),
                  ]}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </tbody>
    </DataTable>
  );
}
