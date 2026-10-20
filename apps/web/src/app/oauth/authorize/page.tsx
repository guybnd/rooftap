import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkAuthorizeRequest } from "@/lib/mcp-oauth";
import { resolveGroupId } from "@/lib/pat";
import { getEnabledModules } from "@/lib/server-modules";
import { Button } from "@/components/ui/button";

// MCP sign-in consent (lib/mcp-oauth.ts). An app such as Claude sends the
// person here; Allow posts to /api/oauth/authorize, which hands the app a
// one-time code on its registered return address.
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") params.set(key, value);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${params.toString()}`)}`);

  const admin = createAdminClient();
  const check = await checkAuthorizeRequest(admin, params);
  if (!check.ok) {
    return (
      <Shell title="Can't connect this app">
        <p className="text-sm text-muted-foreground">{check.message}</p>
      </Shell>
    );
  }

  const appName = check.client.client_name ?? "An app";
  const enabled = await getEnabledModules(admin, await resolveGroupId(admin, user.id));
  const mcpOn = enabled.has("mcp");

  return (
    <Shell title={`Connect ${appName} to Rooftap?`}>
      <p className="text-sm text-muted-foreground">
        {appName} will be able to use your household through Rooftap&apos;s MCP server, as{" "}
        <span className="text-foreground">{user.email ?? "you"}</span>. It gets the tools allowed in Settings, under
        MCP server, and you can disconnect it there at any time.
      </p>
      {!mcpOn && (
        <p className="rounded-xl bg-warning/10 px-3.5 py-3 text-sm text-foreground">
          MCP is switched off for your household. Turn it on in Settings, under Modules, or the app won&apos;t be able
          to reach anything.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Only connect apps you trust. You&apos;ll go back to{" "}
        <span className="font-mono">{new URL(check.request.redirectUri).host}</span>.
      </p>
      <form method="post" action="/api/oauth/authorize" className="flex items-center gap-2 pt-2">
        <input type="hidden" name="client_id" value={check.request.clientId} />
        <input type="hidden" name="redirect_uri" value={check.request.redirectUri} />
        <input type="hidden" name="response_type" value="code" />
        <input type="hidden" name="code_challenge" value={check.request.codeChallenge} />
        <input type="hidden" name="code_challenge_method" value="S256" />
        {check.request.state != null && <input type="hidden" name="state" value={check.request.state} />}
        <Button type="submit" name="decision" value="allow" size="lg" className="px-4">
          Allow
        </Button>
        <Button type="submit" name="decision" value="deny" size="lg" variant="ghost" className="px-4">
          Cancel
        </Button>
      </form>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {children}
      </div>
    </main>
  );
}
