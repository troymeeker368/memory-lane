import { PhotoUploadFormShell } from "@/components/forms/workflow-forms-shells";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getDocumentationWorkflows } from "@/lib/services/documentation-workflows";
import { formatDateTime } from "@/lib/utils";

export default async function PhotoUploadPage() {
  const profile = await requireModuleAccess("documentation");
  const workflows = await getDocumentationWorkflows({ role: profile.role, staffUserId: profile.id });

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Photo Upload</CardTitle>
        <p className="mt-1 text-sm text-muted">Capture photo uploads with multi-file selection and file metadata (no URL field required).</p>
        <div className="mt-3"><PhotoUploadFormShell /></div>
      </Card>
      <Card className="table-wrap">
        <CardTitle>Recent Photo Uploads</CardTitle>
        <table>
          <thead><tr><th>Uploaded</th><th>Taken By</th><th>File</th><th>Type</th><th>Preview</th></tr></thead>
          <tbody>
            {workflows.photos.map((row: any) => (
              <tr key={row.id}><td>{formatDateTime(row.uploaded_at)}</td><td>{row.uploaded_by_name}</td><td>{row.file_name}</td><td>{row.file_type}</td><td><a href={row.photo_url} target="_blank" rel="noopener noreferrer">Open</a></td></tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}








