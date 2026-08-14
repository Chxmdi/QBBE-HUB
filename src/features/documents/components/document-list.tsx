"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import {
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
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
} from "@/features/documents/services/document.commands";
import { formatDate } from "@/lib/utils";

export interface DocumentRow {
  id: string;
  title: string;
  description: string | null;
  kind: "file" | "link";
  mime_type: string | null;
  size_bytes: number | null;
  visibility: string;
  created_at: string;
  owner: { full_name: string } | null;
  project: { id: string; name: string } | null;
  program: { id: string; name: string } | null;
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

function formatSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentList({
  documents,
  canManage,
}: {
  documents: DocumentRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
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
      toast(result.error ?? "Could not open this document.", { tone: "error" });
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  async function archive(doc: DocumentRow) {
    if (!window.confirm(`Archive “${doc.title}”? It leaves the active list.`)) return;
    const result = await archiveDocument(doc.id);
    if (result.ok) {
      toast("Document archived.");
      router.refresh();
    } else {
      toast(result.error ?? "Could not archive.", { tone: "error" });
    }
  }

  return (
    <DataTable minWidth="820px">
      <TableHead>
        <SortableHeader
          label="Name"
          sortKey="title"
          activeKey={sortKey}
          direction={direction}
          onSort={onSort}
        />
        <SortableHeader
          label="Context"
          sortKey="context"
          activeKey={sortKey}
          direction={direction}
          onSort={onSort}
        />
        <SortableHeader
          label="Owner"
          sortKey="owner"
          activeKey={sortKey}
          direction={direction}
          onSort={onSort}
        />
        <TableHeader>Access</TableHeader>
        <SortableHeader
          label="Added"
          sortKey="created_at"
          activeKey={sortKey}
          direction={direction}
          onSort={onSort}
        />
        <TableHeader className="w-10">
          <span className="sr-only">Actions</span>
        </TableHeader>
      </TableHead>
      <tbody>
        {sorted.map((doc) => (
          <TableRow key={doc.id}>
            <TableCell>
              <button
                type="button"
                onClick={() => open(doc)}
                disabled={busyId === doc.id}
                className="flex items-start gap-2.5 text-left hover:text-brand disabled:opacity-60"
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
                  <span className="meta">
                    {doc.kind === "link" ? "External link" : formatSize(doc.size_bytes)}
                  </span>
                </span>
              </button>
            </TableCell>
            <TableCell className="text-muted">
              {doc.project ? (
                <Link
                  href={`/projects/${doc.project.id}`}
                  className="hover:text-brand hover:underline"
                >
                  {doc.project.name}
                </Link>
              ) : doc.program ? (
                <Link
                  href={`/programs/${doc.program.id}`}
                  className="hover:text-brand hover:underline"
                >
                  {doc.program.name}
                </Link>
              ) : (
                "General"
              )}
            </TableCell>
            <TableCell className="text-muted">
              {doc.owner?.full_name ?? "—"}
            </TableCell>
            <TableCell>
              <Badge tone={doc.visibility === "staff" ? "accent" : "neutral"}>
                {doc.visibility === "staff" ? "Staff only" : "All members"}
              </Badge>
            </TableCell>
            <TableCell className="whitespace-nowrap text-muted">
              {formatDate(doc.created_at)}
            </TableCell>
            <TableCell>
              <Menu
                label={`Actions for ${doc.title}`}
                items={[
                  {
                    label: doc.kind === "link" ? "Open link" : "Download",
                    onSelect: () => open(doc),
                    icon:
                      doc.kind === "link" ? (
                        <ExternalLink className="size-4" aria-hidden />
                      ) : (
                        <Download className="size-4" aria-hidden />
                      ),
                  },
                  ...(canManage
                    ? [
                        {
                          label: "Archive",
                          onSelect: () => archive(doc),
                          destructive: true,
                        },
                      ]
                    : []),
                ]}
              />
            </TableCell>
          </TableRow>
        ))}
      </tbody>
    </DataTable>
  );
}
