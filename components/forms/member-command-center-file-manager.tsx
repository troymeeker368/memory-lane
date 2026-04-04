"use client";

import { useEffect, useMemo, useState } from "react";

import { MEMBER_FILE_CATEGORY_OPTIONS } from "@/lib/canonical";
import {
  addMemberFileFormAction,
  deleteMemberFileAction,
  getMemberFileDownloadUrlAction
} from "@/app/(portal)/operations/member-command-center/file-actions";
import { useScopedMutation } from "@/components/forms/use-scoped-mutation";
import { MutationNotice } from "@/components/ui/mutation-notice";
import { formatDateTime } from "@/lib/utils";

interface FileRow {
  id: string;
  file_name: string;
  file_type: string;
  file_data_url: string | null;
  storage_object_path?: string | null;
  category: string;
  category_other: string | null;
  document_source?: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
}

type FileManagerFeedback =
  | {
      kind: "success" | "error";
      message: string;
    }
  | null;

function createUploadToken() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `upload-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function triggerDownload(url: string, fileName?: string) {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  if (fileName) {
    link.download = fileName;
  }
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function formatDocumentSource(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "-";
  if (normalized.startsWith("mcc_manual_upload:")) return "Manual Upload";
  return normalized;
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
  const [feedback, setFeedback] = useState<FileManagerFeedback>(null);
  const [category, setCategory] = useState<(typeof MEMBER_FILE_CATEGORY_OPTIONS)[number]>("Health Unit");
  const [categoryOther, setCategoryOther] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadToken, setUploadToken] = useState<string | null>(null);
  const [localRows, setLocalRows] = useState<FileRow[]>(rows);
  const { isSaving, run } = useScopedMutation();

  const showCustomCategory = useMemo(() => category === "Other", [category]);

  useEffect(() => {
    setLocalRows(rows);
  }, [rows]);

  useEffect(() => {
    setFeedback(null);
    setSelectedFile(null);
    setUploadToken(null);
    setCategory("Health Unit");
    setCategoryOther("");
  }, [memberId]);

  function clearSelection() {
    setSelectedFile(null);
    setUploadToken(null);
    setCategory("Health Unit");
    setCategoryOther("");
  }

  async function onUpload() {
    if (!selectedFile) {
      setFeedback({ kind: "error", message: "Please select a file." });
      return;
    }
    if (!uploadToken) {
      setFeedback({ kind: "error", message: "Upload token is missing. Re-select the file and try again." });
      return;
    }
    if (showCustomCategory && !categoryOther.trim()) {
      setFeedback({ kind: "error", message: "Custom category is required when category is Other." });
      return;
    }

    void run(async () => {
      const formData = new FormData();
      formData.set("memberId", memberId);
      formData.set("fileName", selectedFile.name);
      formData.set("fileType", selectedFile.type || "application/octet-stream");
      formData.set("category", category);
      formData.set("categoryOther", showCustomCategory ? categoryOther : "");
      formData.set("uploadToken", uploadToken);
      formData.set("file", selectedFile);
      return addMemberFileFormAction(formData);
    }, {
      successMessage: "File uploaded.",
      errorMessage: "Unable to upload file.",
      onSuccess: (result) => {
        const createdRow = ((result.data as { row?: FileRow } | null)?.row ?? null) as FileRow | null;
        if (createdRow) {
          setLocalRows((current) => [createdRow, ...current.filter((row) => row.id !== createdRow.id)]);
        }
        setFeedback({ kind: "success", message: "File uploaded." });
        clearSelection();
      },
      onError: (result) => {
        setFeedback({ kind: "error", message: result.error });
      }
    });
  }

  async function onDelete(fileId: string) {
    if (!window.confirm("Delete this file?")) return;

    void run(() => deleteMemberFileAction({ id: fileId, memberId }), {
      successMessage: "File deleted.",
      errorMessage: "Unable to delete file.",
      onSuccess: () => {
        setLocalRows((current) => current.filter((row) => row.id !== fileId));
        setFeedback({ kind: "success", message: "File deleted." });
      },
      onError: (result) => {
        setFeedback({ kind: "error", message: result.error });
      }
    });
  }

  function onFileSelected(file: File | null) {
    setSelectedFile(file);
    setUploadToken(file ? createUploadToken() : null);
  }

  function onOpen(row: FileRow) {
    setFeedback(null);
    void run(() => getMemberFileDownloadUrlAction({ id: row.id, memberId }), {
      successMessage: "File opened.",
      errorMessage: "Unable to open file.",
      onSuccess: (result) => {
        const data = ((result.data ?? {}) as unknown) as { signedUrl: string };
        window.open(data.signedUrl, "_blank", "noopener,noreferrer");
        setFeedback({ kind: "success", message: "File opened." });
      },
      onError: (result) => {
        setFeedback({ kind: "error", message: result.error });
      }
    });
  }

  function onDownload(row: FileRow) {
    setFeedback(null);
    void run(() => getMemberFileDownloadUrlAction({ id: row.id, memberId }), {
      successMessage: "File download started.",
      errorMessage: "Unable to download file.",
      onSuccess: (result) => {
        const data = ((result.data ?? {}) as unknown) as { signedUrl: string; fileName?: string };
        triggerDownload(data.signedUrl, data.fileName || row.file_name);
        setFeedback({ kind: "success", message: "File download started." });
      },
      onError: (result) => {
        setFeedback({ kind: "error", message: result.error });
      }
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
              disabled={isSaving}
              onChange={(event) => onFileSelected(event.target.files?.[0] ?? null)}
            />
            <select
              className="h-10 rounded-lg border border-border px-3"
              value={category}
              disabled={isSaving}
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
                disabled={isSaving}
                onChange={(event) => setCategoryOther(event.target.value)}
              />
            ) : null}
          </div>
          {selectedFile ? (
            <p className="mt-2 text-xs text-muted">
              Ready to upload: {selectedFile.name}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white"
              onClick={onUpload}
              disabled={isSaving || !selectedFile}
            >
              {isSaving ? "Uploading..." : "Upload File"}
            </button>
            {selectedFile ? (
              <button
                type="button"
                className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
                onClick={clearSelection}
                disabled={isSaving}
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
            {localRows.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 7 : 6} className="text-sm text-muted">
                  No files uploaded yet.
                </td>
              </tr>
            ) : (
              localRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.file_name}</td>
                  <td>{row.category === "Other" ? row.category_other ?? "Other" : row.category}</td>
                  <td>{formatDocumentSource(row.document_source)}</td>
                  <td>{formatDateTime(row.uploaded_at)}</td>
                  <td>{row.uploaded_by_name ?? "-"}</td>
                  <td>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {row.file_data_url || row.storage_object_path ? (
                        <>
                          <button
                            type="button"
                            className="font-semibold text-brand"
                            onClick={() => onOpen(row)}
                            disabled={isSaving}
                          >
                            Open
                          </button>
                          <button
                            type="button"
                            className="font-semibold text-brand"
                            onClick={() => onDownload(row)}
                            disabled={isSaving}
                          >
                            Download
                          </button>
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
                        disabled={isSaving}
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

      <MutationNotice kind="error" message={feedback?.kind === "error" ? feedback.message : null} />
      <MutationNotice kind="success" message={feedback?.kind === "success" ? feedback.message : null} />
    </div>
  );
}
