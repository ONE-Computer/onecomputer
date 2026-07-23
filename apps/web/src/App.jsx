import { useEffect, useRef, useState } from "react";
import { Home24Filled, Home24Regular } from "@fluentui/react-icons/svg/home";
import { Clock24Regular } from "@fluentui/react-icons/svg/clock";
import { QuestionCircle24Regular } from "@fluentui/react-icons/svg/question-circle";
import { Open24Regular } from "@fluentui/react-icons/svg/open";
import { ArrowClockwise24Regular } from "@fluentui/react-icons/svg/arrow-clockwise";
import { CheckmarkCircle24Regular } from "@fluentui/react-icons/svg/checkmark-circle";
import { Laptop24Regular, Laptop48Regular } from "@fluentui/react-icons/svg/laptop";
import { Code24Regular } from "@fluentui/react-icons/svg/code";
import { Cloud24Regular } from "@fluentui/react-icons/svg/cloud";
import { Delete24Regular } from "@fluentui/react-icons/svg/delete";
import { Person24Regular } from "@fluentui/react-icons/svg/person";
import { ChevronDown16Regular } from "@fluentui/react-icons/svg/chevron-down";
import { ChevronRight16Regular } from "@fluentui/react-icons/svg/chevron-right";
import { ArrowLeft24Regular } from "@fluentui/react-icons/svg/arrow-left";
import { Dismiss24Regular } from "@fluentui/react-icons/svg/dismiss";
import { Navigation24Regular } from "@fluentui/react-icons/svg/navigation";
import { ShieldCheckmark24Regular } from "@fluentui/react-icons/svg/shield-checkmark";
import { Info24Regular } from "@fluentui/react-icons/svg/info";
import { Bot24Regular } from "@fluentui/react-icons/svg/bot";
import { PlugConnected24Regular } from "@fluentui/react-icons/svg/plug-connected";
import { Settings24Regular } from "@fluentui/react-icons/svg/settings";
import { SignOut24Regular } from "@fluentui/react-icons/svg/sign-out";
import { operationApi, workspaceApi, sandboxApi, connectionApi, approvalApi, authApi, adminApi } from "./workspace-api.js";
import { clipboardStatusForBrowser } from "./clipboard-status.js";
import {
  clearBrowserApprover,
  enrollBrowserApprover,
  getBrowserApproverIdentity,
  hasBrowserApprover,
  loadPendingApproval,
  signApprovalDecision,
} from "./openvtc-browser-agent.js";
import { ConfirmDialog, PolicyIntegrityCard, TextPromptDialog } from "./ui.jsx";

const capabilities = [
  {
    icon: Bot24Regular,
    name: "AI assistant",
    description: "Use your organization’s approved model route.",
    status: "Ready",
  },
  {
    icon: Code24Regular,
    name: "Coding tools",
    description: "Use approved code editors and runtimes.",
    status: "Ready",
  },
  {
    icon: Cloud24Regular,
    name: "OneDrive read",
    description: "View and download files from OneDrive.",
    status: "Planned",
  },
  {
    icon: Delete24Regular,
    name: "OneDrive delete (with approval)",
    description: "Delete files with manager approval.",
    status: "Approval required",
  },
];

const readinessLabels = { identity: "Identity", network: "Network", models: "Models", tools: "Tools" };
const readinessStates = { ready: "Ready", checking: "Checking", unavailable: "Not configured", failed: "Failed" };
const busyStates = new Set(["loading", "provisioning", "restarting", "stopping"]);
const gatewayAdminUrl = import.meta.env.VITE_LITELLM_ADMIN_URL ?? "http://127.0.0.1:4000/ui";
const operationStateLabels = {
  approval_required: "waiting for approval",
  approved: "approved",
  executing: "executing",
  succeeded: "completed",
  denied: "denied",
  failed: "failed",
  expired: "expired",
};

const operationTime = (value) => new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(value));

function NavButton({ active, icon: Icon, label, onClick }) {
  return (
    <button
      className={`nav-button${active ? " active" : ""}`}
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      <Icon aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

function ExternalNavLink({ icon: Icon, label, href }) {
  return (
    <a className="nav-button" href={href} target="_blank" rel="noreferrer">
      <Icon aria-hidden="true" />
      <span>{label}</span>
      <Open24Regular className="nav-external-icon" aria-hidden="true" />
    </a>
  );
}

function Drawer({ title, children, onClose }) {
  const drawerRef = useRef(null);
  const closeButtonRef = useRef(null);
  const closeHandlerRef = useRef(onClose);

  // The parent refreshes operation data while this panel is open. Keep the
  // current close handler without re-running the focus setup on each refresh:
  // focusing the close button causes the browser to scroll this panel to top.
  closeHandlerRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeHandlerRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = [...(drawerRef.current?.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])") ?? [])];
      if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault();
        items.at(-1).focus();
      } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
        event.preventDefault();
        items[0].focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    closeButtonRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div className="drawer-layer" role="presentation" onMouseDown={onClose}>
      <section
        ref={drawerRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="drawer-header">
          <h2 id="drawer-title">{title}</h2>
          <button ref={closeButtonRef} className="icon-button" type="button" onClick={onClose} aria-label="Close panel">
            <Dismiss24Regular aria-hidden="true" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function HomeScreen({ userName, workspace, workspaceState, apiError, operation, operationBusy, onOpen, onRestart, onStop, onDelete, onCapabilities, onOpenOperation, onCreateOperation, onTestGateway, testingGateway }) {
  const isRestarting = workspaceState === "restarting";
  const isOpen = workspaceState === "open";
  const busy = busyStates.has(workspaceState);
  const title = {
    loading: "Checking your workspace",
    not_created: "Your workspace is ready to set up",
    provisioning: "Your workspace is being prepared",
    ready: "Your workspace is ready",
    open: "Your workspace is open",
    restarting: "Your workspace is restarting",
    stopping: "Your workspace is stopping",
    stopped: "Your workspace is stopped",
    failed: "Your workspace needs attention",
  }[workspaceState] ?? "Your workspace";
  const description = {
    loading: "We’re checking the current workspace state.",
    not_created: "Start a managed workspace when you’re ready.",
    provisioning: "The secure sandbox is starting. You can leave this page open.",
    ready: "Your managed workspace is ready and secure. You can open it or restart if you need a fresh start.",
    open: "Your managed workspace is running in a separate secure window.",
    restarting: "We’re preparing a fresh session. This usually takes less than a minute.",
    stopping: "We’re securely closing the current sandbox.",
    stopped: "The sandbox is no longer running. Start it again whenever you need it.",
    failed: "The sandbox could not be prepared. Retry, or contact support if the problem continues.",
  }[workspaceState];
  const readiness = workspace?.readiness ?? { identity: "ready", network: "unavailable", models: "unavailable", tools: "unavailable" };
  const primaryLabel = workspaceState === "not_created" || workspaceState === "stopped" || workspaceState === "failed"
    ? "Start workspace"
    : isOpen ? "Return to workspace" : busy ? "Preparing workspace" : "Open workspace";

  return (
    <div className="home-screen">
      <header className="page-heading">
        <p>Good morning, {userName}</p>
        <h1>{title}</h1>
        <span>{description}</span>
      </header>

      {apiError && <div className="workspace-error" role="alert"><Info24Regular aria-hidden="true" /><span><strong>Workspace service unavailable</strong>{apiError}</span></div>}

      <section className="workspace-section" aria-label="Acme Workspace">
        <div className={`workspace-icon${isRestarting ? " restarting" : ""}`}>
          <Laptop48Regular aria-hidden="true" />
        </div>
        <div className="workspace-details">
          <div className="workspace-name">
            <h2>Acme Workspace</h2>
            <p>Personal workspace</p>
          </div>
          <div className="readiness" aria-label="Workspace readiness">
            {Object.entries(readiness).map(([key, state]) => (
              <div className="readiness-item" key={key}>
                <span className={`status-icon${state !== "ready" ? " pending" : ""}`}>
                  {state !== "ready" ? (
                    <span className="status-dot" aria-hidden="true" />
                  ) : (
                    <CheckmarkCircle24Regular aria-hidden="true" />
                  )}
                </span>
                <span>
                  <strong>{readinessLabels[key]}</strong>
                  <small>{readinessStates[state]}</small>
                </span>
              </div>
            ))}
          </div>
          {workspace?.agents?.length > 0 && (
            <div className="workspace-agents" aria-label="Selected workspace agents">
              {workspace.agents.map((agent) => (
                <span key={agent.id}>
                  <Bot24Regular aria-hidden="true" />
                  <span><strong>{agent.displayName}</strong><small>{agent.state} · v{agent.clientVersion}</small></span>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="workspace-actions">
          <button className="primary-button" type="button" onClick={onOpen} disabled={busy}>
            <Open24Regular aria-hidden="true" />
            {primaryLabel}
          </button>
          {workspaceState === "stopped" ? (
            <button className="secondary-button danger-button" type="button" onClick={onDelete}><Delete24Regular aria-hidden="true" />Delete</button>
          ) : (
            <>
              <button className="secondary-button" type="button" onClick={onRestart} disabled={busy || !workspace}><ArrowClockwise24Regular aria-hidden="true" />Restart</button>
              <button className="secondary-button" type="button" onClick={onStop} disabled={busy || !workspace}><Dismiss24Regular aria-hidden="true" />Stop</button>
            </>
          )}
        </div>
      </section>

      <div className="workspace-protection-grid" aria-label="Workspace protections">
        <div className="workspace-protection">
          <Laptop24Regular aria-hidden="true" />
          <span><strong>Native copy and paste</strong><small>Use your normal keyboard shortcuts. Clipboard contents are never sent to Control.</small></span>
        </div>
        <div className="workspace-protection">
          <ShieldCheckmark24Regular aria-hidden="true" />
          <span><strong>Controlled internet access</strong><small>Only approved destinations can leave the workspace, enforced by its external firewall.</small></span>
        </div>
      </div>

      <PolicyIntegrityCard integrity={workspace?.policyIntegrity} />

      <section className="support-grid">
        <div className="capabilities-block">
          <h2>Your assigned capabilities</h2>
          <div className="capability-list">
            {capabilities.map(({ icon: Icon, name, description }) => (
              <div className="capability-row" key={name}>
                <span className="capability-icon">
                  <Icon aria-hidden="true" />
                </span>
                <span>
                  <strong>{name}</strong>
                  <small>{name === "AI assistant" && workspace?.modelRoute
                    ? `${workspace.modelRoute.alias} · $${workspace.modelRoute.budget.remainingUsd.toFixed(2)} remaining`
                    : description}</small>
                </span>
              </div>
            ))}
          </div>
          <button className="text-button" type="button" onClick={onCapabilities}>
            View all capabilities <ChevronRight16Regular aria-hidden="true" />
          </button>
          {readiness.models === "ready" && readiness.tools === "ready" && (
            <button className="secondary-button gateway-test-button" type="button" onClick={onTestGateway} disabled={testingGateway}>
              <Bot24Regular aria-hidden="true" />
              {testingGateway ? "Checking availability" : "Check AI availability"}
            </button>
          )}
        </div>

        <div className="operation-block">
          <h2>Recent governed operation</h2>
          {operation ? (
            <button className="operation-row" type="button" onClick={onOpenOperation}>
              <span className={`operation-icon${operation.state === "succeeded" ? " complete" : ""}`}>
                {operation.state === "succeeded" ? <CheckmarkCircle24Regular aria-hidden="true" /> : <Clock24Regular aria-hidden="true" />}
              </span>
              <span className="operation-copy">
                <strong>{operation.safeSummary} — {operationStateLabels[operation.state]}</strong>
                <small>{operation.resourceLocation} <i /> Requested by you <i /> Today, {operationTime(operation.requestedAt)}</small>
              </span>
              <span className="operation-link">
                View details <ChevronRight16Regular aria-hidden="true" />
              </span>
            </button>
          ) : (
            <div className="operation-empty">
              <p>Try the approval flow with the protected fixture file.</p>
              <button className="secondary-button" type="button" onClick={onCreateOperation} disabled={operationBusy || !workspace || !["ready", "open"].includes(workspaceState)}>
                <Delete24Regular aria-hidden="true" />
                {operationBusy ? "Creating request" : "Request file deletion"}
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function SignInScreen({ error }) {
  return (
    <main className="signin-screen">
      <section className="signin-card">
        <div className="brand signin-brand" aria-label="ONEComputer"><strong>ONE</strong><span>Computer</span></div>
        <p>Your managed work computer</p>
        <h1>Sign in to continue</h1>
        <span>Use your ME TECH Microsoft account. Your organization’s workspace and agent policy will be applied after sign-in.</span>
        {error && <div className="connection-error" role="alert"><Info24Regular aria-hidden="true" /><span><strong>Sign-in was not completed</strong>{error}</span></div>}
        <a className="primary-button signin-button" href={authApi.loginUrl}><Person24Regular aria-hidden="true" />Sign in with Microsoft</a>
        <small><ShieldCheckmark24Regular aria-hidden="true" />ONEComputer uses a secure server session. Microsoft tokens are not stored in your browser.</small>
      </section>
    </main>
  );
}

function ToolPolicyEditor({ mcpPolicy, loading, policySaving, onPolicyChange, onPolicySave }) {
  const serviceLabels = { mail: "Outlook Mail", calendar: "Calendar", onedrive: "OneDrive", teams: "Teams" };
  const groupedTools = Object.entries(serviceLabels).map(([service, label]) => ({ service, label, tools: mcpPolicy?.tools.filter((tool) => tool.service === service) ?? [] }));
  if (loading && !mcpPolicy) return <div className="tool-policy-loading">Loading Microsoft 365 tools…</div>;
  return (
      <section className="tool-policy-card connector-tool-policy" aria-labelledby="tool-policy-heading">
        <div className="tool-policy-heading">
          <div><p>Organization tool policy</p><h2 id="tool-policy-heading">Tools &amp; approvals</h2></div>
          {mcpPolicy && <span>Version {mcpPolicy.version} · {mcpPolicy.documentHash.slice(0, 12)}…</span>}
        </div>
        <p className="tool-policy-intro">Choose what assigned workspace agents may run immediately, what requires a signed approval, and what is blocked. Saving creates an immutable policy version and refreshes running workspace grants.</p>
        <div className="tool-policy-groups">
          {groupedTools.map((group) => <section key={group.service} className="tool-policy-group">
            <h3>{group.label}<span>{group.tools.length} tools</span></h3>
            <div className="tool-policy-list">
              {group.tools.map((tool) => (
                <label key={tool.name}>
                  <span><strong>{tool.displayName}</strong><small>{tool.description}</small><code>{tool.name}</code></span>
                  <select value={tool.decision} onChange={(event) => onPolicyChange(tool.name, event.target.value)} aria-label={`${tool.displayName} policy`}>
                    <option value="allow">Allow</option>
                    <option value="approval_required">Require approval</option>
                    <option value="deny">Block</option>
                  </select>
                </label>
              ))}
            </div>
          </section>)}
        </div>
        <div className="tool-policy-actions">
          <span><ShieldCheckmark24Regular aria-hidden="true" />Approval rules are enforced in Control, not trusted to the desktop client.</span>
          <button className="primary-button compact-button" type="button" onClick={onPolicySave} disabled={!mcpPolicy || policySaving}>{policySaving ? "Saving changes" : "Save changes"}</button>
        </div>
      </section>
  );
}

function EgressFirewallCard({ versions, saving, onSave }) {
  const latest = versions.filter((item, index, all) => all.findIndex((candidate) => candidate.securityGroupId === item.securityGroupId) === index);
  const [selectedId, setSelectedId] = useState("");
  const selected = selectedId === "__new__" ? undefined : latest.find((item) => item.securityGroupId === selectedId) ?? latest[0];
  const [draft, setDraft] = useState(null);
  const [rule, setRule] = useState({ host: "", protocol: "https", port: 443, includeSubdomains: false, purpose: "" });

  useEffect(() => {
    if (!selected) return;
    setSelectedId(selected.securityGroupId);
    setDraft({
      securityGroupId: selected.securityGroupId,
      name: selected.name,
      description: selected.description,
      rules: selected.rules,
    });
  }, [selected?.id]);

  const startNew = () => {
    setSelectedId("__new__");
    setDraft({ name: "Approved web access", description: "Reviewed outbound web destinations for this sandbox.", rules: [] });
  };
  const addRule = () => {
    if (!draft || !rule.host.trim() || !rule.purpose.trim()) return;
    const id = `${rule.protocol}-${rule.host.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${rule.port}`.slice(0, 64);
    setDraft({ ...draft, rules: [...draft.rules, { ...rule, id, host: rule.host.trim(), purpose: rule.purpose.trim(), action: "allow", port: Number(rule.port) }] });
    setRule({ host: "", protocol: "https", port: 443, includeSubdomains: false, purpose: "" });
  };

  return (
    <section className="egress-firewall-card" aria-labelledby="egress-firewall-heading">
      <div className="egress-firewall-heading">
        <div>
          <p>Egress firewall</p>
          <h2 id="egress-firewall-heading">Network security groups</h2>
          <span>Default-deny domain, protocol, and port rules enforced outside the sandbox.</span>
        </div>
        <button className="secondary-button" type="button" onClick={startNew}>Create group</button>
      </div>
      {latest.length > 0 && (
        <label className="egress-group-picker">
          <span>Security group</span>
          <select value={selectedId || selected?.securityGroupId || ""} onChange={(event) => setSelectedId(event.target.value)}>
            {selectedId === "__new__" && <option value="__new__">New security group</option>}
            {latest.map((item) => <option key={item.securityGroupId} value={item.securityGroupId}>{item.name} · v{item.version}</option>)}
          </select>
        </label>
      )}
      {draft && (
        <div className="egress-editor">
          <div className="egress-fields">
            <label><span>Name</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            <label><span>Description</span><input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
          </div>
          <div className="egress-rule-list">
            {draft.rules.map((item, index) => (
              <article key={`${item.id}-${index}`}>
                <div><strong>{item.host}</strong><small>{item.purpose}</small></div>
                <code>{item.protocol.toUpperCase()} :{item.port}{item.includeSubdomains ? " · includes subdomains" : " · exact domain"}</code>
                <button type="button" aria-label={`Remove ${item.host}`} onClick={() => setDraft({ ...draft, rules: draft.rules.filter((_, ruleIndex) => ruleIndex !== index) })}>Remove</button>
              </article>
            ))}
          </div>
          <div className="egress-rule-builder">
            <label><span>Domain</span><input placeholder="updates.example.com" value={rule.host} onChange={(event) => setRule({ ...rule, host: event.target.value })} /></label>
            <label><span>Protocol</span><select value={rule.protocol} onChange={(event) => setRule({ ...rule, protocol: event.target.value, port: event.target.value === "https" ? 443 : 80 })}><option value="https">HTTPS</option><option value="http">HTTP</option></select></label>
            <label><span>Port</span><input type="number" min="1" max="65535" value={rule.port} onChange={(event) => setRule({ ...rule, port: event.target.value })} /></label>
            <label className="egress-subdomains"><input type="checkbox" checked={rule.includeSubdomains} onChange={(event) => setRule({ ...rule, includeSubdomains: event.target.checked })} /><span>Include subdomains</span></label>
            <label className="egress-purpose"><span>Purpose</span><input placeholder="Why this access is needed" value={rule.purpose} onChange={(event) => setRule({ ...rule, purpose: event.target.value })} /></label>
            <button className="secondary-button" type="button" onClick={addRule}>Add destination</button>
          </div>
          <div className="egress-actions">
            <span><ShieldCheckmark24Regular aria-hidden="true" />HTTPS paths are not inspected. Redirects are checked as new connections.</span>
            <button className="primary-button compact-button" type="button" disabled={saving || !draft.name || !draft.description} onClick={() => onSave(draft)}>{saving ? "Saving version" : draft.securityGroupId ? "Save new version" : "Create security group"}</button>
          </div>
        </div>
      )}
    </section>
  );
}

function AdminScreen({ users, loading, busyUserId, onAssign, onRevoke, onVersion, mcpPolicy, onConfigureConnector }) {
  return (
    <div className="secondary-screen admin-screen">
      <header className="page-heading compact">
        <p>Organization administration</p>
        <h1>Workspace policy</h1>
        <span>Manage policy versions and who receives workspace authority. Connector-specific controls live with each connection.</span>
      </header>
      <div className="admin-toolbar">
        <div><strong>MVP standard workspace</strong><small>Workspace, agent, model, network, connector, and protected-operation rules</small></div>
        <button className="secondary-button" type="button" onClick={onVersion}>Create new version</button>
      </div>
      <section className="admin-connector-summary" aria-labelledby="admin-connector-heading">
        <span className="connection-logo compact"><PlugConnected24Regular aria-hidden="true" /></span>
        <div>
          <p>Microsoft 365 connector</p>
          <h2 id="admin-connector-heading">Tool controls are configured with the connection</h2>
          <small>{mcpPolicy ? `Active policy version ${mcpPolicy.version} · ${mcpPolicy.tools.length} tools` : "Open the connector to review its tools and approval rules."}</small>
        </div>
        <button className="secondary-button" type="button" onClick={onConfigureConnector}>Open connector settings<ChevronRight16Regular aria-hidden="true" /></button>
      </section>
      <section className="admin-user-list" aria-label="Organization users">
        {loading ? <p>Loading organization users…</p> : users.map((item) => (
          <article key={item.userId}>
            <div className="admin-user-copy">
              <strong>{item.displayName}</strong><small>{item.email}</small>
              <span>{item.roles.includes("administrator") ? "Administrator" : "Employee"}</span>
            </div>
            <div className="admin-policy-copy">
              {item.effectivePolicy ? <>
                <strong>Version {item.effectivePolicy.version} assigned</strong>
                <small>Immutable policy {item.effectivePolicy.documentHash.slice(0, 12)}…</small>
              </> : <><strong>No active policy</strong><small>Workspace and agent authority is revoked.</small></>}
            </div>
            {item.effectivePolicy
              ? <button className="secondary-button danger-button" type="button" disabled={busyUserId === item.userId} onClick={() => onRevoke(item.userId)}>Revoke</button>
              : <button className="primary-button compact-button" type="button" disabled={busyUserId === item.userId} onClick={() => onAssign(item.userId)}>Assign policy</button>}
          </article>
        ))}
      </section>
    </div>
  );
}

function FirewallScreen({ users, loading, busyUserId, versions, saving, onSave, onAttach }) {
  return (
    <div className="secondary-screen firewall-screen">
      <header className="page-heading compact">
        <p>Network control</p>
        <h1>Egress firewall</h1>
        <span>Create reusable security groups and attach one immutable version to each managed sandbox.</span>
      </header>
      <EgressFirewallCard versions={versions} saving={saving} onSave={onSave} />
      <section className="firewall-attachments" aria-labelledby="firewall-attachments-heading">
        <div className="firewall-attachments-heading">
          <div>
            <p>Assignments</p>
            <h2 id="firewall-attachments-heading">Sandbox attachments</h2>
          </div>
          <span>Stop a running workspace before changing its firewall.</span>
        </div>
        <div className="admin-user-list">
          {loading ? <p>Loading sandbox assignments…</p> : users.map((item) => (
            <article key={item.userId}>
              <div className="admin-user-copy">
                <strong>{item.displayName}</strong><small>{item.email}</small>
                <span>{item.roles.includes("administrator") ? "Administrator" : "Employee"}</span>
              </div>
              <div className="admin-policy-copy">
                {item.effectivePolicy ? <>
                  <strong>{item.effectivePolicy.egressSecurityGroup ? `${item.effectivePolicy.egressSecurityGroup.name} · v${item.effectivePolicy.egressSecurityGroup.version}` : "No firewall attached"}</strong>
                  <small>One pinned security-group version per sandbox policy</small>
                  <select aria-label={`Firewall for ${item.displayName}`} value={item.effectivePolicy.egressSecurityGroup?.id ?? ""} disabled={busyUserId === item.userId} onChange={(event) => onAttach(item.userId, event.target.value)}>
                    <option value="" disabled>Choose firewall</option>
                    {versions.map((version) => <option key={version.id} value={version.id}>{version.name} · v{version.version}</option>)}
                  </select>
                </> : <><strong>Policy required</strong><small>Assign a workspace policy in Admin before attaching a firewall.</small></>}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function ActivityScreen({ operations, onOpenOperation }) {
  return (
    <div className="secondary-screen">
      <header className="page-heading compact">
        <p>Your workspace history</p>
        <h1>Activity</h1>
        <span>Recent workspace and governed-operation events, shown without sensitive content.</span>
      </header>
      <div className="timeline">
        {operations.map((operation) => (
          <button type="button" key={operation.id} onClick={() => onOpenOperation(operation)}>
            <span className={`timeline-icon${operation.state === "succeeded" ? "" : " pending"}`}>
              {operation.state === "succeeded" ? <CheckmarkCircle24Regular aria-hidden="true" /> : <Clock24Regular aria-hidden="true" />}
            </span>
            <span><strong>{operation.safeSummary}</strong><small>{operationStateLabels[operation.state]} · {new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(operation.requestedAt))}</small></span>
            <ChevronRight16Regular aria-hidden="true" />
          </button>
        ))}
        <div>
          <span className="timeline-icon"><Laptop24Regular aria-hidden="true" /></span>
          <span><strong>Acme Workspace became ready</strong><small>All assigned services connected · Today, 8:58 AM</small></span>
        </div>
        <div>
          <span className="timeline-icon"><ShieldCheckmark24Regular aria-hidden="true" /></span>
          <span><strong>Workspace access verified</strong><small>Identity and policy checks passed · Today, 8:57 AM</small></span>
        </div>
      </div>
    </div>
  );
}

function HelpScreen() {
  return (
    <div className="secondary-screen">
      <header className="page-heading compact">
        <p>ONEComputer support</p>
        <h1>How can we help?</h1>
        <span>Quick answers for opening your workspace and understanding protected actions.</span>
      </header>
      <div className="help-list">
        <details open>
          <summary>Why does my workspace show separate readiness checks?</summary>
          <p>Each check tells you exactly what is available. You can enter only when your identity, network, models, and tools are ready.</p>
        </details>
        <details>
          <summary>Where do I approve a protected action?</summary>
          <p>Approvals happen through your organization’s trusted approval channel. ONEComputer shows the outcome but cannot approve on your behalf.</p>
        </details>
        <details>
          <summary>What happens when I restart?</summary>
          <p>Your current session closes and ONEComputer prepares a fresh managed workspace with the same assigned capabilities.</p>
        </details>
      </div>
    </div>
  );
}

function SandboxScreen({ settings, loading, saving, error, workspaceState, onSave }) {
  const [profileId, setProfileId] = useState("");
  const [modelAlias, setModelAlias] = useState("");
  const [agentIds, setAgentIds] = useState([]);

  useEffect(() => {
    if (!settings) return;
    setProfileId(settings.profileId);
    setModelAlias(settings.modelAlias);
    setAgentIds(settings.agentIds);
  }, [settings?.profileId, settings?.modelAlias, settings?.agentIds]);

  const workspaceStopped = !["provisioning", "ready", "open", "restarting", "stopping"].includes(workspaceState);
  const dirty = settings && (
    profileId !== settings.profileId
    || modelAlias !== settings.modelAlias
    || agentIds.join(",") !== settings.agentIds.join(",")
  );
  const toggleAgent = (agentId) => setAgentIds((current) => (
    current.includes(agentId) ? current.filter((id) => id !== agentId) : [...current, agentId]
  ));

  return (
    <div className="secondary-screen sandbox-screen">
      <header className="page-heading compact">
        <p>Your managed environment</p>
        <h1>Sandbox</h1>
        <span>Choose from the workspace and AI routes your organization has approved. Changes apply the next time the workspace starts.</span>
      </header>
      {error && <div className="workspace-error" role="alert"><Info24Regular aria-hidden="true" /><span><strong>Sandbox settings unavailable</strong>{error}</span></div>}
      {loading || !settings ? <p className="sandbox-loading">Loading your assigned sandbox…</p> : (
        <form className="sandbox-form" onSubmit={(event) => { event.preventDefault(); onSave(profileId, modelAlias, agentIds); }}>
          <section className="sandbox-section" aria-labelledby="sandbox-profile-heading">
            <div className="sandbox-section-heading">
              <span className="sandbox-section-icon"><Laptop24Regular aria-hidden="true" /></span>
              <span><h2 id="sandbox-profile-heading">Workspace profile</h2><p>The application, resources, persistence, and network boundary are managed as one versioned profile.</p></span>
            </div>
            <fieldset className="profile-options">
              <legend className="sr-only">Workspace profile</legend>
              {settings.availableProfiles.map((profile) => (
                <label className={`profile-option${profileId === profile.id ? " selected" : ""}`} key={profile.id}>
                  <input type="radio" name="profile" value={profile.id} checked={profileId === profile.id} onChange={() => setProfileId(profile.id)} />
                  <span className="profile-radio" aria-hidden="true" />
                  <span className="profile-copy">
                    <strong>{profile.displayName}</strong>
                    <small>{profile.description}</small>
                    <span>{profile.client} {profile.clientVersion} · {profile.resources.cpus} CPUs · {profile.resources.memoryGiB} GB · Persistent home</span>
                  </span>
                  <span className="profile-version">v{profile.version}</span>
                </label>
              ))}
            </fieldset>
          </section>

          <section className="sandbox-section" aria-labelledby="sandbox-agents-heading">
            <div className="sandbox-section-heading">
              <span className="sandbox-section-icon"><Bot24Regular aria-hidden="true" /></span>
              <span><h2 id="sandbox-agents-heading">Workspace agents</h2><p>Enable one or both approved clients. Each client receives its own revocable model and tool identity.</p></span>
            </div>
            <fieldset className="agent-options">
              <legend className="sr-only">Workspace agents</legend>
              {settings.availableAgents.map((agent) => (
                <label className={`agent-option${agentIds.includes(agent.id) ? " selected" : ""}`} key={agent.id}>
                  <input type="checkbox" value={agent.id} checked={agentIds.includes(agent.id)} onChange={() => toggleAgent(agent.id)} />
                  <span className="agent-check" aria-hidden="true">{agentIds.includes(agent.id) ? "✓" : ""}</span>
                  <span className="profile-copy">
                    <strong>{agent.displayName}</strong>
                    <small>{agent.description}</small>
                    <span>Version {agent.clientVersion} · {agent.license} · {agent.resources.memoryMiB} MB declared memory</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {!agentIds.length && <p className="sandbox-selection-error" role="alert">Select at least one workspace agent.</p>}
          </section>

          <section className="sandbox-section" aria-labelledby="sandbox-model-heading">
            <div className="sandbox-section-heading">
              <span className="sandbox-section-icon"><Bot24Regular aria-hidden="true" /></span>
              <span><h2 id="sandbox-model-heading">AI route</h2><p>Each selected agent receives this alias through its own LiteLLM grant. Provider credentials remain outside the sandbox.</p></span>
            </div>
            <div className="model-options" role="radiogroup" aria-labelledby="sandbox-model-heading">
              {settings.availableModels.map((model) => (
                <label className={modelAlias === model.alias ? "selected" : ""} key={model.alias}>
                  <input type="radio" name="model" value={model.alias} checked={modelAlias === model.alias} onChange={() => setModelAlias(model.alias)} />
                  <span><strong>{model.displayName}</strong><small>{model.provider} through ONEComputer</small></span>
                  {modelAlias === model.alias && <CheckmarkCircle24Regular aria-hidden="true" />}
                </label>
              ))}
            </div>
          </section>

          <div className="sandbox-summary">
            <ShieldCheckmark24Regular aria-hidden="true" />
            <span><strong>Effective boundary</strong><small>Persistent home · gateway-only network · {agentIds.length} distinct agent {agentIds.length === 1 ? "identity" : "identities"} · no direct provider login</small></span>
          </div>
          <div className="sandbox-summary">
            <ShieldCheckmark24Regular aria-hidden="true" />
            <span>
              <strong>Egress firewall</strong>
              <small>{settings.egress ? `${settings.egress.name} · version ${settings.egress.version} · ${settings.egress.rules.length} approved ${settings.egress.rules.length === 1 ? "destination" : "destinations"} · all other public access denied` : "No public internet destinations are assigned."}</small>
            </span>
          </div>
          {!workspaceStopped && <p className="sandbox-stop-note"><Info24Regular aria-hidden="true" />Stop the workspace before changing its profile, model route, or agents.</p>}
          <div className="sandbox-actions">
            <button className="primary-button" type="submit" disabled={!dirty || saving || !workspaceStopped || !agentIds.length}>{saving ? "Saving settings" : "Save sandbox settings"}</button>
            <small>{settings.updatedAt ? `Last saved ${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(settings.updatedAt))}` : "Using the policy default until you save."}</small>
          </div>
        </form>
      )}
    </div>
  );
}

const connectionReason = {
  M365_OAUTH_DENIED: "Microsoft 365 access was not granted. You can try again when you’re ready.",
  M365_OAUTH_STATE_INVALID: "That connection attempt expired or was already used. Please start again.",
  M365_OAUTH_STATE_EXPIRED: "That connection attempt expired. Please start again.",
  M365_OAUTH_IDENTITY_MISMATCH: "That connection attempt belongs to another signed-in user.",
  M365_TOKEN_EXCHANGE_FAILED: "Microsoft 365 could not complete the connection. Please try again.",
};

function ApprovalDeviceCard({ displayName }) {
  const [status, setStatus] = useState(null);
  const [localReady, setLocalReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  const refresh = async () => {
    const localIdentity = await getBrowserApproverIdentity();
    const remote = await approvalApi.status(localIdentity?.did);
    const local = await hasBrowserApprover(remote.approver?.approverDid);
    setStatus(remote);
    setLocalReady(local);
  };

  useEffect(() => {
    refresh().catch((error) => setMessage(error.message));
  }, []);

  const enroll = async () => {
    setBusy("enroll");
    setMessage("");
    try {
      const challenge = await approvalApi.challenge();
      await enrollBrowserApprover(
        challenge,
        `${displayName}’s browser`,
        (document) => approvalApi.enroll(challenge.id, document),
        (approverDid) => approvalApi.revoke(approverDid),
      );
      await refresh();
      setMessage("This browser is now your approval device.");
    } catch (error) {
      setMessage(error.name === "NotAllowedError" ? "Device verification was cancelled." : error.message);
    } finally {
      setBusy("");
    }
  };

  const disconnect = async () => {
    setConfirmRemove(false);
    setBusy("disconnect");
    setMessage("");
    try {
      await approvalApi.revoke(status?.approver?.approverDid);
      await clearBrowserApprover(status?.approver?.approverDid);
      await refresh();
      setMessage("The browser approval device was removed.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy("");
    }
  };

  const connected = status?.connected;
  const usable = connected && localReady;
  return (
    <>
      <section className="connection-card approval-device-card" aria-labelledby="approval-device-title">
        <div className="connection-logo"><ShieldCheckmark24Regular aria-hidden="true" /></div>
        <div className="connection-copy">
          <div className="connection-title-row">
            <div>
              <h2 id="approval-device-title">Approval device</h2>
              <p>OpenVTC browser agent</p>
            </div>
            <span className={`connection-status ${usable ? "connected" : "disconnected"}`}>
              {usable ? "Ready" : connected ? "Key unavailable" : "Not enrolled"}
            </span>
          </div>
          <p className="connection-description">Set up this browser once. Protected actions appear in their governed-operation panel and require one deliberate biometric, PIN, or security-key confirmation.</p>
          {connected && <p className="connection-metadata">{status.approver.displayName} · {status.approver.approverDid.slice(0, 26)}…</p>}
          {message && <p className="approval-device-message" role="status" aria-live="polite">{message}</p>}
        </div>
        <div className="connection-actions">
          {usable ? (
            <button className="secondary-button" type="button" onClick={() => setConfirmRemove(true)} disabled={Boolean(busy)}>{busy === "disconnect" ? "Removing" : "Remove device"}</button>
          ) : (
            <button className="primary-button" type="button" onClick={enroll} disabled={Boolean(busy)}>
              <ShieldCheckmark24Regular aria-hidden="true" />
              {busy === "enroll" ? "Waiting for device" : connected ? "Replace approval device" : "Set up this browser"}
            </button>
          )}
        </div>
      </section>
      {confirmRemove && (
        <ConfirmDialog
          title="Remove this approval device?"
          description="Pending protected actions will remain blocked until this browser or another companion is enrolled again."
          confirmLabel="Remove device"
          danger
          onConfirm={disconnect}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </>
  );
}

function Microsoft365Detail({ connection, loading, busy, onConnect, onDisconnect, displayName, isAdmin, activeTab, onTabChange, onBack, mcpPolicy, policyLoading, policySaving, onPolicyChange, onPolicySave }) {
  const connected = connection?.state === "connected";
  const expired = connection?.state === "expired";
  const connectedAt = connection?.connectedAt
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(connection.connectedAt))
    : null;
  return (
    <div className="secondary-screen connections-screen connector-detail-screen">
      <button className="connector-back-button" type="button" onClick={onBack}><ArrowLeft24Regular aria-hidden="true" />Back to Connections</button>
      <header className="connector-detail-header">
        <div className="connection-logo"><PlugConnected24Regular aria-hidden="true" /></div>
        <div>
          <p>Connected service</p>
          <h1>Microsoft 365</h1>
          <span>Outlook Mail, Calendar, OneDrive, and Teams</span>
        </div>
        <span className={`connection-status ${connected ? "connected" : expired ? "expired" : "disconnected"}`}>
          {loading ? "Checking" : connected ? "Connected" : expired ? "Reconnect required" : "Not connected"}
        </span>
      </header>

      <nav className="connector-tabs" aria-label="Microsoft 365 settings">
        <button className={activeTab === "overview" ? "active" : ""} type="button" onClick={() => onTabChange("overview")}>Overview</button>
        {isAdmin && <button className={activeTab === "tools" ? "active" : ""} type="button" onClick={() => onTabChange("tools")}>Tools &amp; approvals</button>}
      </nav>

      {activeTab === "tools" && isAdmin ? (
        <ToolPolicyEditor mcpPolicy={mcpPolicy} loading={policyLoading} policySaving={policySaving} onPolicyChange={onPolicyChange} onPolicySave={onPolicySave} />
      ) : (
        <div className="connector-overview">
          <section className="connector-overview-card">
            <div>
              <p>Connection status</p>
              <h2>{connected ? "Ready for assigned workspaces" : expired ? "Microsoft access needs attention" : "Connect your work account"}</h2>
              <span>{connected ? "Your workspace agent can use the tools your organization has allowed." : "Connect once to make approved Microsoft 365 tools available to your workspace."}</span>
              <div className="connection-services" aria-label="Included services"><span>Outlook Mail</span><span>Calendar</span><span>OneDrive</span><span>Teams</span></div>
              {connectedAt && <p className="connection-metadata">Connected {connectedAt}</p>}
            </div>
            <div className="connection-actions">
              {connected ? (
                <button className="secondary-button" type="button" onClick={onDisconnect} disabled={busy || loading}>{busy ? "Disconnecting" : "Disconnect"}</button>
              ) : (
                <button className="primary-button" type="button" onClick={onConnect} disabled={busy || loading}><PlugConnected24Regular aria-hidden="true" />{busy ? "Opening Microsoft" : expired ? "Reconnect" : "Connect Microsoft 365"}</button>
              )}
            </div>
          </section>
          <ApprovalDeviceCard displayName={displayName} />
          <div className="connection-privacy-note"><ShieldCheckmark24Regular aria-hidden="true" /><p>Microsoft tokens stay in the MCP gateway. The browser approval key stays encrypted on this device. Neither secret is sent to the workspace.</p></div>
        </div>
      )}
    </div>
  );
}

function ConnectionsScreen({ connection, loading, busy, error, onConnect, onDisconnect, displayName, isAdmin, view, onViewChange, mcpPolicy, policyLoading, policySaving, onPolicyChange, onPolicySave }) {
  const connected = connection?.state === "connected";
  const expired = connection?.state === "expired";
  const connectedAt = connection?.connectedAt
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(connection.connectedAt))
    : null;
  if (view !== "list") {
    return <Microsoft365Detail connection={connection} loading={loading} busy={busy} onConnect={onConnect} onDisconnect={onDisconnect} displayName={displayName} isAdmin={isAdmin} activeTab={view === "microsoft365-tools" ? "tools" : "overview"} onTabChange={(tab) => onViewChange(`microsoft365-${tab}`)} onBack={() => onViewChange("list")} mcpPolicy={mcpPolicy} policyLoading={policyLoading} policySaving={policySaving} onPolicyChange={onPolicyChange} onPolicySave={onPolicySave} />;
  }
  return (
    <div className="secondary-screen connections-screen">
      <header className="page-heading compact">
        <p>Your connected services</p>
        <h1>Connections</h1>
        <span>Connect approved work services once. Your managed workspace receives scoped access without receiving your Microsoft credentials.</span>
      </header>

      {error && <div className="connection-error" role="alert"><Info24Regular aria-hidden="true" /><span><strong>Microsoft 365 was not connected</strong>{error}</span></div>}

      <section className="connection-card" aria-labelledby="microsoft-365-title">
        <div className="connection-logo"><PlugConnected24Regular aria-hidden="true" /></div>
        <div className="connection-copy">
          <div className="connection-title-row">
            <div>
              <h2 id="microsoft-365-title">Microsoft 365</h2>
              <p>Outlook Mail, Calendar, OneDrive, and Teams</p>
            </div>
            <span className={`connection-status ${connected ? "connected" : expired ? "expired" : "disconnected"}`}>
              {loading ? "Checking" : connected ? "Connected" : expired ? "Reconnect required" : "Not connected"}
            </span>
          </div>
          <p className="connection-description">Use approved Microsoft 365 tools through the ONEComputer AI gateway. Protected actions require approval.</p>
          <div className="connection-services" aria-label="Included services">
            <span>Outlook Mail</span><span>Calendar</span><span>OneDrive</span><span>Teams</span>
          </div>
          {connectedAt && <p className="connection-metadata">Connected {connectedAt}</p>}
        </div>
        <div className="connection-actions">
          {connected ? (
            <>
              <button className="primary-button" type="button" onClick={() => onViewChange(isAdmin ? "microsoft365-tools" : "microsoft365-overview")}>Manage<ChevronRight16Regular aria-hidden="true" /></button>
              <button className="connection-quiet-button" type="button" onClick={onDisconnect} disabled={busy || loading}>{busy ? "Disconnecting" : "Disconnect"}</button>
            </>
          ) : (
            <button className="primary-button" type="button" onClick={onConnect} disabled={busy || loading}>
              <PlugConnected24Regular aria-hidden="true" />
              {busy ? "Opening Microsoft" : expired ? "Reconnect" : "Connect Microsoft 365"}
            </button>
          )}
        </div>
      </section>

      <ApprovalDeviceCard displayName={displayName} />

      <div className="connection-privacy-note"><ShieldCheckmark24Regular aria-hidden="true" /><p>Microsoft tokens stay in the MCP gateway. The browser approval key stays encrypted on this device. Neither secret is sent to the workspace.</p></div>
    </div>
  );
}

export function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [activeNav, setActiveNav] = useState("Home");
  const [workspace, setWorkspace] = useState(null);
  const [workspaceState, setWorkspaceState] = useState("loading");
  const [apiError, setApiError] = useState("");
  const [drawer, setDrawer] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [testingGateway, setTestingGateway] = useState(false);
  const [gatewayResult, setGatewayResult] = useState(null);
  const [operation, setOperation] = useState(null);
  const [operationHistory, setOperationHistory] = useState([]);
  const [operationAudit, setOperationAudit] = useState(null);
  const [operationBusy, setOperationBusy] = useState(false);
  const [approvalRequest, setApprovalRequest] = useState(null);
  const [approvalRequestState, setApprovalRequestState] = useState("idle");
  const [approvalRequestMessage, setApprovalRequestMessage] = useState("");
  const [approvalReload, setApprovalReload] = useState(0);
  const [m365Connection, setM365Connection] = useState(null);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [connectionsView, setConnectionsView] = useState("list");
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminBusyUserId, setAdminBusyUserId] = useState("");
  const [egressVersions, setEgressVersions] = useState([]);
  const [egressSaving, setEgressSaving] = useState(false);
  const [mcpPolicy, setMcpPolicy] = useState(null);
  const [mcpPolicyLoading, setMcpPolicyLoading] = useState(false);
  const [mcpPolicySaving, setMcpPolicySaving] = useState(false);
  const [sandboxSettings, setSandboxSettings] = useState(null);
  const [sandboxLoading, setSandboxLoading] = useState(false);
  const [sandboxSaving, setSandboxSaving] = useState(false);
  const [sandboxError, setSandboxError] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const [revisionPromptOpen, setRevisionPromptOpen] = useState(false);
  const [revisionSaving, setRevisionSaving] = useState(false);
  const surfacedApprovalIds = useRef(new Set());
  const mainContentRef = useRef(null);
  const sidebarRef = useRef(null);

  const requestConfirmation = (options) => new Promise((resolve) => {
    setConfirmation({ ...options, resolve });
  });

  const settleConfirmation = (accepted) => {
    const pending = confirmation;
    setConfirmation(null);
    pending?.resolve(accepted);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("signin") === "error") setAuthError("Microsoft could not verify this sign-in. Please try again.");
    authApi.session()
      .then((value) => { setSession(value); setAuthError(""); })
      .catch((error) => { if (error.code !== "UNAUTHENTICATED") setAuthError(error.message); })
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!mobileNavOpen) return undefined;
    const previouslyFocused = document.activeElement;
    const sidebar = sidebarRef.current;
    sidebar?.querySelector(".nav-button")?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileNavOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = [...(sidebar?.querySelectorAll("a[href], button:not([disabled])") ?? [])];
      if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault();
        items.at(-1).focus();
      } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
        event.preventDefault();
        items[0].focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [mobileNavOpen]);

  const applyWorkspace = (next) => {
    setWorkspace(next);
    setWorkspaceState(next?.state ?? "not_created");
    setApiError("");
  };

  const showApiError = (error) => {
    setApiError(error.message);
    setToast("");
  };

  useEffect(() => {
    if (!session) return;
    workspaceApi.current().then(applyWorkspace).catch((error) => {
      if (error.code === "WORKSPACE_NOT_FOUND") applyWorkspace(null);
      else { setWorkspaceState("failed"); showApiError(error); }
    });
    operationApi.recent().then(setOperation).catch(showApiError);
    operationApi.list().then((value) => setOperationHistory(value.operations)).catch(showApiError);
    connectionApi.microsoft365()
      .then(setM365Connection)
      .catch((error) => setConnectionError(error.message))
      .finally(() => setConnectionLoading(false));
  }, [session?.user.id]);

  useEffect(() => {
    if (!session) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("view") !== "connections") return;
    setActiveNav("Connections");
    setConnectionsView("microsoft365-overview");
    const result = params.get("m365");
    if (result === "connected") {
      setToast("Microsoft 365 is connected.");
      setConnectionLoading(true);
      connectionApi.microsoft365()
        .then((status) => { setM365Connection(status); setConnectionError(""); })
        .catch((error) => setConnectionError(error.message))
        .finally(() => setConnectionLoading(false));
    } else if (result === "error") {
      const reason = params.get("reason");
      setConnectionError(connectionReason[reason] ?? "Microsoft 365 could not complete the connection. Please try again.");
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, [session?.user.id]);

  useEffect(() => {
    if (activeNav !== "Admin" || !session?.roles.includes("administrator")) return;
    setAdminLoading(true);
    Promise.all([adminApi.users(), adminApi.mcpPolicy()])
      .then(([users, policy]) => {
        setAdminUsers(users.users);
        setMcpPolicy(policy);
      })
      .catch(showApiError)
      .finally(() => setAdminLoading(false));
  }, [activeNav, session?.user.id]);

  useEffect(() => {
    if (activeNav !== "Firewall" || !session?.roles.includes("administrator")) return;
    setAdminLoading(true);
    adminApi.egressSecurityGroups()
      .then(async (egress) => {
        const users = await adminApi.users();
        setAdminUsers(users.users);
        setEgressVersions(egress.securityGroups);
      })
      .catch(showApiError)
      .finally(() => setAdminLoading(false));
  }, [activeNav, session?.user.id]);

  useEffect(() => {
    if (activeNav !== "Connections" || !session?.roles.includes("administrator") || connectionsView !== "microsoft365-tools") return;
    setMcpPolicyLoading(true);
    adminApi.mcpPolicy()
      .then(setMcpPolicy)
      .catch(showApiError)
      .finally(() => setMcpPolicyLoading(false));
  }, [activeNav, connectionsView, session?.user.id]);

  useEffect(() => {
    if (activeNav !== "Sandbox" || !session) return;
    setSandboxLoading(true);
    sandboxApi.settings()
      .then((value) => { setSandboxSettings(value); setSandboxError(""); })
      .catch((error) => setSandboxError(error.message))
      .finally(() => setSandboxLoading(false));
  }, [activeNav, session?.user.id]);

  useEffect(() => {
    const delay = ["provisioning", "restarting", "stopping"].includes(workspaceState)
      ? 2000
      : ["ready", "open"].includes(workspaceState)
        ? 10000
        : null;
    if (!delay) return undefined;
    const interval = window.setInterval(() => workspaceApi.current().then(applyWorkspace).catch(showApiError), delay);
    return () => window.clearInterval(interval);
  }, [workspaceState]);

  useEffect(() => {
    if (!operation || !["approved", "executing"].includes(operation.state)) return undefined;
    const interval = window.setInterval(() => operationApi.get(operation.id).then(setOperation).catch(showApiError), 1500);
    return () => window.clearInterval(interval);
  }, [operation?.id, operation?.state]);

  useEffect(() => {
    if (!session) return undefined;
    let active = true;
    const refreshRecentOperation = async () => {
      try {
        const recent = await operationApi.recent();
        if (!active || !recent) return;
        setOperation(recent);
        if (recent.state === "approval_required" && !surfacedApprovalIds.current.has(recent.id)) {
          surfacedApprovalIds.current.add(recent.id);
          setDrawer("request");
          setToast("An agent action is waiting for your approval.");
        }
      } catch (error) {
        if (active) showApiError(error);
      }
    };
    const interval = window.setInterval(refreshRecentOperation, 1500);
    return () => { active = false; window.clearInterval(interval); };
  }, [session?.user.id]);

  useEffect(() => {
    if (!operation) return;
    setOperationHistory((items) => [operation, ...items.filter((item) => item.id !== operation.id)]);
  }, [operation?.id, operation?.state, operation?.updatedAt]);

  useEffect(() => {
    if (drawer !== "request" || !operation) { setOperationAudit(null); return; }
    operationApi.audit(operation.id).then(setOperationAudit).catch(showApiError);
  }, [drawer, operation?.id, operation?.state]);

  useEffect(() => {
    if (drawer !== "request" || operation?.state !== "approval_required"
      || operation.requiredApprovalChannel !== "openvtc-task-consent") {
      setApprovalRequest(null);
      setApprovalRequestState("idle");
      setApprovalRequestMessage("");
      return undefined;
    }
    let active = true;
    setApprovalRequest(null);
    setApprovalRequestState("loading");
    setApprovalRequestMessage("");
    getBrowserApproverIdentity()
      .then(async (local) => {
        const status = await approvalApi.status(local?.did);
        const localReady = Boolean(local) && await hasBrowserApprover(status.approver?.approverDid);
        if (!status.connected || !localReady) {
          if (active) {
            setApprovalRequestState("setup");
            setApprovalRequestMessage(status.connected
              ? "This browser profile no longer has the key for the enrolled approval device. Replace it once to rebind this pending request."
              : "Set up this browser as your approval device before deciding this operation.");
          }
          return;
        }
        const request = await loadPendingApproval(() => approvalApi.pending(local.did), status.executorDid);
        if (!active) return;
        setApprovalRequest(request);
        setApprovalRequestState(request ? "ready" : "empty");
        setApprovalRequestMessage(request ? "Signed request verified. One device confirmation will approve or deny it." : "No live signed approval request is available.");
      })
      .catch((error) => {
        if (!active) return;
        setApprovalRequestState("error");
        setApprovalRequestMessage(error.message);
      });
    return () => { active = false; };
  }, [drawer, operation?.id, operation?.state, operation?.requiredApprovalChannel, approvalReload]);

  const createWorkspace = async () => {
    setWorkspaceState("provisioning");
    setApiError("");
    try { applyWorkspace(await workspaceApi.create()); setToast("Your managed workspace is being prepared."); }
    catch (error) { setWorkspaceState("failed"); showApiError(error); }
  };

  const restartWorkspace = async () => {
    setWorkspaceState("restarting");
    setApiError("");
    try { applyWorkspace(await workspaceApi.restart(workspace.id)); setToast("Restart requested. Preparing a fresh workspace…"); }
    catch (error) { setWorkspaceState(workspace?.state ?? "failed"); showApiError(error); }
  };

  const openWorkspace = async () => {
    if (!workspace || ["not_created", "stopped", "failed"].includes(workspaceState)) return createWorkspace();
    const sessionWindow = window.open("about:blank", "onecomputer-workspace");
    try {
      const result = await workspaceApi.open(workspace.id);
      applyWorkspace(result.workspace);
      const clipboardStatus = clipboardStatusForBrowser(result.launch.clipboard);
      if (sessionWindow) sessionWindow.location.replace(result.launch.launchUrl);
      else window.location.assign(result.launch.launchUrl);
      setToast(clipboardStatus.message);
    } catch (error) {
      sessionWindow?.close();
      showApiError(error);
    }
  };

  const stopWorkspace = async () => {
    setWorkspaceState("stopping");
    try { applyWorkspace(await workspaceApi.stop(workspace.id)); setToast("Your workspace has stopped."); }
    catch (error) { setWorkspaceState(workspace?.state ?? "failed"); showApiError(error); }
  };

  const deleteWorkspace = async () => {
    if (!await requestConfirmation({
      title: "Delete this workspace record?",
      description: "The stopped workspace record and its retained home storage will be removed. You can create a new workspace later.",
      confirmLabel: "Delete workspace",
      danger: true,
    })) return;
    try { await workspaceApi.delete(workspace.id); applyWorkspace(null); setToast("Workspace deleted."); }
    catch (error) { showApiError(error); }
  };

  const testGateway = async () => {
    if (!workspace) return;
    setTestingGateway(true);
    setApiError("");
    try {
      const result = await workspaceApi.testGateway(workspace.id);
      setGatewayResult(result);
      setDrawer("gateway");
      setToast("The scoped model and tool routes are ready.");
    } catch (error) {
      showApiError(error);
    } finally {
      setTestingGateway(false);
    }
  };

  const createGovernedOperation = async () => {
    if (!workspace) return;
    setOperationBusy(true);
    setApiError("");
    try {
      const created = await operationApi.createDeleteFile(workspace.id, "/Finance/2026/Q3-draft.docx");
      setOperation(created);
      setOperationHistory((items) => [created, ...items.filter((item) => item.id !== created.id)]);
      setDrawer("request");
      setToast("Protected deletion request created. No tool has run yet.");
    } catch (error) {
      showApiError(error);
    } finally {
      setOperationBusy(false);
    }
  };

  const decideGovernedOperation = async (decision) => {
    if (!operation) return;
    setOperationBusy(true);
    setApiError("");
    try {
      const decided = await operationApi.decideWithFixture(operation.id, decision);
      setOperation(decided);
      setToast(decision === "approve" ? "Approved operation executed once through the governed gateway." : "The protected operation was denied.");
    } catch (error) {
      showApiError(error);
      operationApi.get(operation.id).then(setOperation).catch(() => undefined);
    } finally {
      setOperationBusy(false);
    }
  };

  const decideWithApprovalDevice = async (decision) => {
    if (!approvalRequest) return;
    setOperationBusy(true);
    setApprovalRequestMessage("");
    try {
      const signed = await signApprovalDecision(approvalRequest, decision);
      const response = await approvalApi.decide(signed.transportToken, signed.document);
      setOperation(response.operation);
      setApprovalRequest(null);
      setApprovalRequestState("idle");
      setToast(decision === "approve" ? "Approved. The bound operation was released once." : "Denied. No connector action was released.");
    } catch (error) {
      setApprovalRequestMessage(error.name === "NotAllowedError" ? "Device verification was cancelled." : error.message);
      operationApi.get(operation.id).then(setOperation).catch(() => undefined);
    } finally {
      setOperationBusy(false);
    }
  };

  const connectMicrosoft365 = () => {
    setConnectionBusy(true);
    setConnectionError("");
    window.location.assign(connectionApi.microsoft365AuthorizeUrl);
  };

  const disconnectMicrosoft365 = async () => {
    if (!await requestConfirmation({
      title: "Disconnect Microsoft 365?",
      description: "ONEComputer will revoke this connection. Your Microsoft account and Microsoft 365 data will not be deleted.",
      confirmLabel: "Disconnect",
      danger: true,
    })) return;
    setConnectionBusy(true);
    setConnectionError("");
    try {
      const status = await connectionApi.disconnectMicrosoft365();
      setM365Connection(status);
      setToast("Microsoft 365 was disconnected.");
    } catch (error) {
      setConnectionError(error.message);
    } finally {
      setConnectionBusy(false);
    }
  };

  const saveSandboxSettings = async (profileId, modelAlias, agentIds) => {
    setSandboxSaving(true);
    setSandboxError("");
    try {
      const saved = await sandboxApi.save(profileId, modelAlias, agentIds);
      setSandboxSettings(saved);
      setToast("Sandbox settings saved. Start the workspace to apply them.");
    } catch (error) {
      setSandboxError(error.message);
    } finally {
      setSandboxSaving(false);
    }
  };

  const selectNav = (name) => {
    setActiveNav(name);
    if (name === "Connections") setConnectionsView("list");
    setMobileNavOpen(false);
    window.requestAnimationFrame(() => mainContentRef.current?.focus());
  };

  const configureMicrosoft365 = () => {
    setActiveNav("Connections");
    setConnectionsView("microsoft365-tools");
  };

  const refreshAdminUsers = () => adminApi.users().then((value) => setAdminUsers(value.users));
  const refreshEgressGroups = () => adminApi.egressSecurityGroups().then((value) => setEgressVersions(value.securityGroups));
  const assignPolicy = async (userId) => {
    setAdminBusyUserId(userId);
    try { await adminApi.assignPolicy(userId); await refreshAdminUsers(); setToast("The MVP policy is assigned."); }
    catch (error) { showApiError(error); }
    finally { setAdminBusyUserId(""); }
  };
  const revokePolicy = async (userId) => {
    if (!await requestConfirmation({
      title: "Revoke this user’s policy?",
      description: "New workspace and agent authority will be revoked. Their persistent workspace storage will not be deleted.",
      confirmLabel: "Revoke policy",
      danger: true,
    })) return;
    setAdminBusyUserId(userId);
    try { await adminApi.revokePolicy(userId); await refreshAdminUsers(); setToast("Workspace and agent authority was revoked."); }
    catch (error) { showApiError(error); }
    finally { setAdminBusyUserId(""); }
  };
  const createPolicyVersion = async () => {
    setRevisionPromptOpen(true);
  };
  const submitPolicyVersion = async (revisionNote) => {
    setRevisionSaving(true);
    try {
      const version = await adminApi.createPolicyVersion(revisionNote);
      setRevisionPromptOpen(false);
      setToast(`Policy version ${version.version} created. Existing assignments remain pinned.`);
    }
    catch (error) { showApiError(error); }
    finally { setRevisionSaving(false); }
  };
  const saveEgressSecurityGroup = async (document) => {
    setEgressSaving(true);
    try {
      const saved = await adminApi.saveEgressSecurityGroup(document);
      await refreshEgressGroups();
      setToast(`${saved.name} version ${saved.version} is ready to attach.`);
    } catch (error) { showApiError(error); }
    finally { setEgressSaving(false); }
  };
  const attachEgressSecurityGroup = async (userId, securityGroupVersionId) => {
    setAdminBusyUserId(userId);
    try {
      await adminApi.assignEgressSecurityGroup(userId, securityGroupVersionId);
      await refreshAdminUsers();
      setToast("The sandbox firewall assignment is pinned to that version.");
    } catch (error) { showApiError(error); }
    finally { setAdminBusyUserId(""); }
  };
  const changeMcpPolicy = (name, decision) => setMcpPolicy((current) => ({
    ...current,
    tools: current.tools.map((tool) => tool.name === name ? { ...tool, decision } : tool),
  }));
  const saveMcpPolicy = async () => {
    if (!mcpPolicy) return;
    setMcpPolicySaving(true);
    try {
      const saved = await adminApi.saveMcpPolicy(Object.fromEntries(mcpPolicy.tools.map((tool) => [tool.name, tool.decision])));
      const refreshed = await adminApi.mcpPolicy();
      setMcpPolicy(refreshed);
      await refreshAdminUsers();
      setToast(saved.workspaceGrants?.failed
        ? `Microsoft 365 tool policy version ${saved.version} is active. ${saved.workspaceGrants.failed} running workspace grant could not refresh; restart that workspace before retrying.`
        : `Microsoft 365 tool policy version ${saved.version} is active for new calls${saved.workspaceGrants?.refreshed ? ` in ${saved.workspaceGrants.refreshed} running workspace` : ""}.`);
    } catch (error) { showApiError(error); }
    finally { setMcpPolicySaving(false); }
  };
  const logout = async () => {
    try { await authApi.logout(); } finally { window.location.assign("/"); }
  };

  if (authLoading) return <main className="signin-screen"><div className="signin-loading">Checking your work account…</div></main>;
  if (!session) return <SignInScreen error={authError} />;
  const firstName = session.user.displayName.split(" ")[0] || session.user.displayName;
  const initials = session.user.displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const today = new Date();
  const todayLabel = new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(today);
  const todayValue = today.toISOString().slice(0, 10);
  const modalActive = Boolean(drawer || confirmation || revisionPromptOpen);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside ref={sidebarRef} id="primary-navigation" className={`sidebar${mobileNavOpen ? " mobile-open" : ""}`} aria-label="Application navigation" inert={modalActive ? true : undefined}>
        <div className="brand" aria-label="ONEComputer">
          <strong>ONE</strong><span>Computer</span>
        </div>
        <nav aria-label="Primary navigation">
          <NavButton active={activeNav === "Home"} icon={activeNav === "Home" ? Home24Filled : Home24Regular} label="Home" onClick={() => selectNav("Home")} />
          <NavButton active={activeNav === "Activity"} icon={Clock24Regular} label="Activity" onClick={() => selectNav("Activity")} />
          <NavButton active={activeNav === "Sandbox"} icon={Laptop24Regular} label="Sandbox" onClick={() => selectNav("Sandbox")} />
          {session.roles.includes("administrator") && <NavButton active={activeNav === "Firewall"} icon={ShieldCheckmark24Regular} label="Firewall" onClick={() => selectNav("Firewall")} />}
          <NavButton active={activeNav === "Connections"} icon={PlugConnected24Regular} label="Connections" onClick={() => selectNav("Connections")} />
          {session.roles.includes("administrator") && <NavButton active={activeNav === "Admin"} icon={Settings24Regular} label="Admin" onClick={() => selectNav("Admin")} />}
          <ExternalNavLink icon={Bot24Regular} label="Gateway" href={gatewayAdminUrl} />
          <NavButton active={activeNav === "Help"} icon={QuestionCircle24Regular} label="Help" onClick={() => selectNav("Help")} />
        </nav>
        <div className="sidebar-profile">
          <Person24Regular aria-hidden="true" />
          <span><strong>{session.user.displayName}</strong><small>{session.tenant.displayName}</small></span>
          <ChevronDown16Regular aria-hidden="true" />
        </div>
      </aside>

      <main id="main-content" ref={mainContentRef} className="main-content" tabIndex="-1" inert={mobileNavOpen || modalActive ? true : undefined}>
        <header className="topbar">
          <button className="mobile-menu" type="button" aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileNavOpen} aria-controls="primary-navigation" onClick={() => setMobileNavOpen((value) => !value)}>
            <Navigation24Regular aria-hidden="true" />
          </button>
          <div className="mobile-brand"><strong>ONE</strong><span>Computer</span></div>
          <div className="topbar-spacer" />
          <time dateTime={todayValue}>{todayLabel}</time>
          <span className="topbar-divider" />
          <button className="account-button" type="button" onClick={() => setProfileOpen((value) => !value)} aria-expanded={profileOpen} aria-label={`Account menu for ${session.user.displayName}`}>
            <span>{initials}</span>
            <ChevronDown16Regular aria-hidden="true" />
          </button>
          {profileOpen && (
            <div className="profile-menu">
              <strong>{session.user.displayName}</strong>
              <span>{session.user.email}</span>
              <button type="button" onClick={logout}><SignOut24Regular aria-hidden="true" />Sign out</button>
            </div>
          )}
        </header>

        {activeNav === "Home" && (
          <HomeScreen
            userName={firstName}
            workspaceState={workspaceState}
            workspace={workspace}
            apiError={apiError}
            onOpen={openWorkspace}
            onRestart={restartWorkspace}
            onStop={stopWorkspace}
            onDelete={deleteWorkspace}
            onCapabilities={() => setDrawer("capabilities")}
            operation={operation}
            operationBusy={operationBusy}
            onOpenOperation={() => setDrawer("request")}
            onCreateOperation={createGovernedOperation}
            onTestGateway={testGateway}
            testingGateway={testingGateway}
          />
        )}
        {activeNav === "Activity" && <ActivityScreen operations={operationHistory} onOpenOperation={(selected) => { setOperation(selected); setDrawer("request"); }} />}
        {activeNav === "Sandbox" && <SandboxScreen settings={sandboxSettings} loading={sandboxLoading} saving={sandboxSaving} error={sandboxError} workspaceState={workspaceState} onSave={saveSandboxSettings} />}
        {activeNav === "Connections" && (
          <ConnectionsScreen
            connection={m365Connection}
            loading={connectionLoading}
            busy={connectionBusy}
            error={connectionError}
            onConnect={connectMicrosoft365}
            onDisconnect={disconnectMicrosoft365}
            displayName={session.user.displayName}
            isAdmin={session.roles.includes("administrator")}
            view={connectionsView}
            onViewChange={setConnectionsView}
            mcpPolicy={mcpPolicy}
            policyLoading={mcpPolicyLoading}
            policySaving={mcpPolicySaving}
            onPolicyChange={changeMcpPolicy}
            onPolicySave={saveMcpPolicy}
          />
        )}
        {activeNav === "Firewall" && session.roles.includes("administrator") && <FirewallScreen users={adminUsers} loading={adminLoading} busyUserId={adminBusyUserId} versions={egressVersions} saving={egressSaving} onSave={saveEgressSecurityGroup} onAttach={attachEgressSecurityGroup} />}
        {activeNav === "Admin" && session.roles.includes("administrator") && <AdminScreen users={adminUsers} loading={adminLoading} busyUserId={adminBusyUserId} onAssign={assignPolicy} onRevoke={revokePolicy} onVersion={createPolicyVersion} mcpPolicy={mcpPolicy} onConfigureConnector={configureMicrosoft365} />}
        {activeNav === "Help" && <HelpScreen />}
      </main>

      {mobileNavOpen && <button className="mobile-scrim" type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}

      {confirmation && (
        <ConfirmDialog
          title={confirmation.title}
          description={confirmation.description}
          confirmLabel={confirmation.confirmLabel}
          danger={confirmation.danger}
          onConfirm={() => settleConfirmation(true)}
          onCancel={() => settleConfirmation(false)}
        />
      )}

      {revisionPromptOpen && (
        <TextPromptDialog
          title="Create an immutable policy version"
          description="Describe why this organization policy version is being created. Existing assignments remain pinned until explicitly changed."
          label="Revision note"
          defaultValue="Policy review"
          confirmLabel="Create version"
          busy={revisionSaving}
          onConfirm={submitPolicyVersion}
          onCancel={() => setRevisionPromptOpen(false)}
        />
      )}

      {drawer === "capabilities" && (
        <Drawer title="Assigned capabilities" onClose={() => setDrawer(null)}>
          <p className="drawer-intro">These are the tools and actions your organization has made available in this workspace.</p>
          <div className="drawer-list">
            {capabilities.map(({ icon: Icon, name, description, status }) => (
              <div key={name}>
                <span className="capability-icon"><Icon aria-hidden="true" /></span>
                <span><strong>{name}</strong><small>{description}</small></span>
                <span className={status === "Ready" ? "ready-label" : "approval-label"}>{status}</span>
              </div>
            ))}
          </div>
          <div className="drawer-note"><Info24Regular aria-hidden="true" /><p>Capabilities are assigned by your organization and enforced when an action runs.</p></div>
        </Drawer>
      )}

      {drawer === "request" && operation && (
        <Drawer title="Governed operation" onClose={() => setDrawer(null)}>
          <div className={`request-status${operation.state === "succeeded" ? " complete" : ""}`}>
            {operation.state === "succeeded" ? <CheckmarkCircle24Regular aria-hidden="true" /> : <Clock24Regular aria-hidden="true" />}
            <span><strong>{operationStateLabels[operation.state]}</strong><small>Requested today at {operationTime(operation.requestedAt)}</small></span>
          </div>
          <dl className="request-details">
            <div><dt>Action</dt><dd>{operation.action}</dd></div>
            <div><dt>File</dt><dd>{operation.resourceName}</dd></div>
            <div><dt>Location</dt><dd>{operation.resourceLocation}</dd></div>
            <div><dt>Requested by</dt><dd>{session.user.displayName}</dd></div>
            {operation.agentId && <div><dt>Agent</dt><dd><code>{operation.agentId.slice(0, 16)}…</code></dd></div>}
            {operation.policyVersionId && <div><dt>Policy version</dt><dd><code>{operation.policyVersionId.slice(0, 12)}…</code></dd></div>}
            <div><dt>Tool</dt><dd><code>{operation.toolName}</code></dd></div>
            <div><dt>Operation binding</dt><dd><code>{operation.operationDigest.slice(0, 12)}…</code></dd></div>
          </dl>
          {operation.receipt && (
            <div className="gateway-response">
              <strong>Execution receipt</strong>
              <p>{operation.receipt.resultSummary}</p>
            </div>
          )}
          {operationAudit?.events?.length > 0 && (
            <div className="audit-trail">
              <strong>Audit trail</strong>
              <ol>
                {operationAudit.events.map((event, index) => (
                  <li key={`${event.createdAt}-${index}`}>
                    <span>{event.eventType.replaceAll("_", " ")}</span>
                    <small>{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(event.createdAt))}</small>
                    <code>{event.correlationId.slice(0, 12)}…</code>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="drawer-note"><ShieldCheckmark24Regular aria-hidden="true" /><p>{
            operation.state === "approval_required"
              ? operation.requiredApprovalChannel === "openvtc-task-consent"
                ? "The exact action is stored and bound to this request. The tool has not run. Review its signed effects with your approval device."
                : "The exact action is stored and bound to this request. The tool has not run. Use the temporary local fixture below to test approval or denial."
              : operation.state === "succeeded"
                ? "The bound operation was approved, executed once, and recorded with a receipt."
                : operation.state === "denied"
                  ? "The request was denied and the tool was not called."
                  : "ONEComputer is preserving the authoritative operation state."
          }</p></div>
          {operation.state === "approval_required" && operation.requiredApprovalChannel === "local-fixture" ? (
            <div className="approval-actions">
              <button className="primary-button" type="button" onClick={() => decideGovernedOperation("approve")} disabled={operationBusy}>
                <ShieldCheckmark24Regular aria-hidden="true" />{operationBusy ? "Applying decision" : "Approve with local fixture"}
              </button>
              <button className="secondary-button danger-button" type="button" onClick={() => decideGovernedOperation("deny")} disabled={operationBusy}>Deny</button>
            </div>
          ) : operation.state === "approval_required" && approvalRequestState === "ready" ? (
            <div className="approval-review drawer-approval-review" aria-live="polite">
              <div className="approval-review-heading">
                <span>Signed approval request</span>
                <strong>{approvalRequest.payload.sideEffects}</strong>
              </div>
              <h3>{approvalRequest.payload.effects?.[0]?.summary ?? operation.safeSummary}</h3>
              <dl>
                <div><dt>Signed by</dt><dd>ONEComputer Control</dd></div>
                <div><dt>Approval binding</dt><dd>{approvalRequest.payload.payloadDigest.slice(0, 16)}…</dd></div>
              </dl>
              <p className="approval-warning">One device confirmation signs your decision for only this exact operation.</p>
              {approvalRequestMessage && <p className="approval-device-message" role="status">{approvalRequestMessage}</p>}
              <div className="approval-review-actions">
                <button className="primary-button" type="button" onClick={() => decideWithApprovalDevice("approve")} disabled={operationBusy}>
                  <ShieldCheckmark24Regular aria-hidden="true" />{operationBusy ? "Verifying device" : "Verify and approve"}
                </button>
                <button className="secondary-button danger-button" type="button" onClick={() => decideWithApprovalDevice("deny")} disabled={operationBusy}>Deny</button>
              </div>
            </div>
          ) : operation.state === "approval_required" && approvalRequestState === "setup" ? (
            <div className="approval-actions approval-state-actions">
              <p className="approval-device-message" role="status">{approvalRequestMessage}</p>
              <button className="primary-button" type="button" onClick={() => { setDrawer(null); setActiveNav("Connections"); }}>
                <ShieldCheckmark24Regular aria-hidden="true" />Set up approval device
              </button>
              <button className="secondary-button" type="button" onClick={() => setDrawer(null)}>Close</button>
            </div>
          ) : operation.state === "approval_required" ? (
            <div className="approval-actions approval-state-actions">
              <p className="approval-device-message" role="status">{approvalRequestState === "loading" ? "Verifying the signed approval request…" : approvalRequestMessage}</p>
              {approvalRequestState !== "loading" && (
                <button className="secondary-button" type="button" onClick={() => setApprovalReload((value) => value + 1)}>Try again</button>
              )}
              <button className="secondary-button" type="button" onClick={() => setDrawer(null)}>Close</button>
            </div>
          ) : (
            <button className="secondary-button full-width" type="button" onClick={() => setDrawer(null)}>Close</button>
          )}
        </Drawer>
      )}

      {drawer === "gateway" && gatewayResult && (
        <Drawer title="AI connection" onClose={() => setDrawer(null)}>
          <div className="gateway-result-status"><CheckmarkCircle24Regular aria-hidden="true" /><span><strong>Approved model route is available</strong><small>Scoped to this managed workspace and agent</small></span></div>
          <dl className="request-details">
            <div><dt>Base API URL</dt><dd><code>{gatewayResult.apiBaseUrl}</code></dd></div>
            <div><dt>MCP gateway</dt><dd><code>{gatewayResult.mcpUrl}</code></dd></div>
            <div><dt>Model route</dt><dd>{gatewayResult.model}</dd></div>
            <div><dt>Budget remaining</dt><dd>${gatewayResult.modelRoute.budget.remainingUsd.toFixed(2)} of ${gatewayResult.modelRoute.budget.limitUsd.toFixed(2)}</dd></div>
            <div><dt>Budget period</dt><dd>30 days</dd></div>
            <div><dt>Request limit</dt><dd>{gatewayResult.modelRoute.limits.requestsPerMinute} per minute</dd></div>
            <div><dt>Fallback</dt><dd>None — fails closed</dd></div>
            <div><dt>Assigned tools</dt><dd>{gatewayResult.tools.map((tool) => tool.name).join(", ") || "None"}</dd></div>
          </dl>
          <div className="drawer-note"><ShieldCheckmark24Regular aria-hidden="true" /><p>This check reads availability and usage metadata only. It does not send a prompt. Provider and LiteLLM administrator credentials are not shared with the workspace.</p></div>
          <button className="secondary-button full-width" type="button" onClick={() => setDrawer(null)}>Close</button>
        </Drawer>
      )}

      {toast && <div className="toast" role="status" aria-live="polite"><CheckmarkCircle24Regular aria-hidden="true" />{toast}</div>}
    </div>
  );
}
