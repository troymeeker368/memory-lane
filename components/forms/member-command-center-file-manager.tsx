"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { MEMBER_FILE_CATEGORY_OPTIONS } from "@/lib/canonical";
import { addMemberFileAction, deleteMemberFileAction } from "@/app/(portal)/operations/member-command-center/actions";
import { formatDateTime } from "@/lib/utils";

interface FileRow {
  id: string;
  file_name: string;
  file_type: string;
  file_data_url: string | null;
  category: string;
  category_other: string | null;
  document_source?: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
}

export function MemberCommandCenterFileManager({
  memberId,
  rows,
  canEdit
}: {
  memberId: string;
  rows: FileRow[];
  canEdit: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [category, setCategory] = useState<(typeof MEMBER_FILE_CATEGORY_OPTIONS)[number]>("Health Unit");
  const [categoryOther, setCategoryOther] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const router = useRouter();

  const showCustomCategory = useMemo(() => category === "Other", [category]);

  useEffect(() => {
    setStatus(null);
    setSelectedFile(null);
    setCategory("Health Unit");
    setCategoryOther("");
  }, [memberId]);

  function clearSelection() {
    setSelectedFile(null);
    setCategory("Health Unit");
    setCategoryOther("");
  }

  function fileToDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
          return;
        }
        reject(new Error("Could not read file."));
      };
      reader.onerror = () => reject(new Error("Could not read file."));
      reader.readAsDataURL(file);
    });
  }

  async function onUpload() {
    if (!selectedFile) {
      setStatus("Error: Please select a file.");
      return;
    }
    if (showCustomCategory && !categoryOther.trim()) {
      setStatus("Error: Custom category is required when category is Other.");
      return;
    }

    startTransition(async () => {
      try {
        const dataUrl = await fileToDataUrl(selectedFile);
        const result = await addMemberFileAction({
          memberId,
          fileName: selectedFile.name,
          fileType: selectedFile.type || "application/octet-stream",
          fileDataUrl: dataUrl,
          category,
          categoryOther: showCustomCategory ? categoryOther : ""
        });

        if (result?.error) {
          setStatus(`Error: ${result.error}`);
          return;
        }

        setStatus("File uploaded.");
        clearSelection();
        router.refresh();
      } catch {
        setStatus("Error: Unable to process selected file.");
      }
    });
  }

  async function onDelete(fileId: string) {
    if (!window.confirm("Delete this file?")) return;

    startTransition(async () => {
      const result = await deleteMemberFileAction({ id: fileId, memberId });
      if (result?.error) {
        setStatus(`Error: ${result.error}`);
        return;
      }
      setStatus("File deleted.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {canEdit ? (
        <div className="rounded-lg border border-border p-3">
          <p className="text-sm font-semibold">Upload Member File</p>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            <input
              type="file"
              className="h-10 rounded-lg border border-border px-3 py-1 text-sm"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            />
            <select
              className="h-10 rounded-lg border border-border px-3"
              value={category}
              onChange={(event) => {
                const next = event.target.value as (typeof MEMBER_FILE_CATEGORY_OPTIONS)[number];
                setCategory(next);
                if (next !== "Other") {
                  setCategoryOther("");
                }
              }}
            >
              {MEMBER_FILE_CATEGORY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {showCustomCategory ? (
              <input
                className="h-10 rounded-lg border border-border px-3"
                placeholder="Custom category"
                value={categoryOther}
                onChange={(event) => setCategoryOther(event.target.value)}
              />
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white"
              onClick={onUpload}
              disabled={isPending}
            >
              {isPending ? "Uploading..." : "Upload File"}
            </button>
            {selectedFile ? (
              <button
                type="button"
                className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
                onClick={clearSelection}
                disabled={isPending}
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th>Category</th>
              <th>Source</th>
              <th>Uploaded</th>
              <th>Uploaded By</th>
              <th>Actions</th>
              {canEdit ? <th>Delete</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 7 : 6} className="text-sm text-muted">
                  No files uploaded yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.file_name}</td>
                  <td>{row.category === "Other" ? row.category_other ?? "Other" : row.category}</td>
                  <td>{row.document_source ?? "-"}</td>
                  <td>{formatDateTime(row.uploaded_at)}</td>
                  <td>{row.uploaded_by_name ?? "-"}</td>
                  <td>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {row.file_data_url ? (
                        <>
                          <a href={row.file_data_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand">
                            Open
                          </a>
                          <a href={row.file_data_url} download={row.file_name} className="font-semibold text-brand">
                            Download
                          </a>
                        </>
                      ) : (
                        "-"
                      )}
                    </div>
                  </td>
                  {canEdit ? (
                    <td>
                      <button
                        type="button"
                        className="text-xs font-semibold text-red-700"
                        onClick={() => onDelete(row.id)}
                      >
                        Delete
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}
