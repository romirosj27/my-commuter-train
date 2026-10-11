import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { API_BASE } from '@/lib/api';
import { authClient, authErrorMessage, sessionQuery } from '@/lib/auth';

async function downloadExport() {
  const res = await fetch(`${API_BASE}/api/me/export`, { credentials: 'include' });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'my-data.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

export function AccountPage() {
  const { data: session } = useQuery(sessionQuery);
  const [exportError, setExportError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();

  async function deleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    const { error } = await authClient.deleteUser({ password });
    setDeleting(false);
    if (error) {
      setDeleteError(error.status === 400 ? 'That password is not right.' : authErrorMessage(error));
      return;
    }
    qc.clear();
    await navigate({ to: '/sign-in' });
  }

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">Account</h1>
      <Card>
        <CardHeader>
          <CardTitle>{session?.user.name}</CardTitle>
          <CardDescription>{session?.user.email}</CardDescription>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Your data</CardTitle>
          <CardDescription>Download everything we hold about you as a JSON file.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          <Button variant="outline" className="w-fit" onClick={() => downloadExport().catch((e: Error) => setExportError(e.message))}>
            <Download /> Download my data
          </Button>
          {exportError && <p className="text-destructive text-sm">{exportError}</p>}
        </CardContent>
      </Card>
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Delete account</CardTitle>
          <CardDescription>Permanently deletes your account, commutes, alert history and journey log. This can't be undone.</CardDescription>
        </CardHeader>
        <CardContent>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="destructive">Delete my account</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete your account?</DialogTitle>
                <DialogDescription>Enter your password to confirm. All your data will be removed.</DialogDescription>
              </DialogHeader>
              <Field label="Password" htmlFor="delete-password">
                <Input id="delete-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              {deleteError && (
                <Alert variant="destructive">
                  <AlertDescription>{deleteError}</AlertDescription>
                </Alert>
              )}
              <DialogFooter>
                <Button variant="destructive" disabled={!password || deleting} onClick={deleteAccount}>
                  {deleting ? 'Deleting…' : 'Delete everything'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  );
}
