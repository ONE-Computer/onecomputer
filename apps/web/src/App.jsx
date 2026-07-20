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
import { Dismiss24Regular } from "@fluentui/react-icons/svg/dismiss";
import { Navigation24Regular } from "@fluentui/react-icons/svg/navigation";
import { ShieldCheckmark24Regular } from "@fluentui/react-icons/svg/shield-checkmark";
import { Info24Regular } from "@fluentui/react-icons/svg/info";
import { Bot24Regular } from "@fluentui/react-icons/svg/bot";
import { PlugConnected24Regular } from "@fluentui/react-icons/svg/plug-connected";
import { operationApi, workspaceApi, connectionApi } from "./workspace-api.js";

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
  const closeButtonRef = useRef(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    closeButtonRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="drawer-layer" role="presentation" onMouseDown={onClose}>
      <section
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

function HomeScreen({ workspace, workspaceState, apiError, operation, operationBusy, onOpen, onRestart, onStop, onDelete, onCapabilities, onOpenOperation, onCreateOperation, onTestGateway, testingGateway }) {
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
        <p>Good morning, Alex</p>
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
                  <small>{description}</small>
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
              {testingGateway ? "Testing connection" : "Test AI connection"}
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

function ActivityScreen({ operation, onOpenOperation }) {
  return (
    <div className="secondary-screen">
      <header className="page-heading compact">
        <p>Your workspace history</p>
        <h1>Activity</h1>
        <span>Recent workspace and governed-operation events, shown without sensitive content.</span>
      </header>
      <div className="timeline">
        {operation && (
          <button type="button" onClick={onOpenOperation}>
            <span className={`timeline-icon${operation.state === "succeeded" ? "" : " pending"}`}>
              {operation.state === "succeeded" ? <CheckmarkCircle24Regular aria-hidden="true" /> : <Clock24Regular aria-hidden="true" />}
            </span>
            <span><strong>{operation.safeSummary}</strong><small>{operationStateLabels[operation.state]} · Today, {operationTime(operation.requestedAt)}</small></span>
            <ChevronRight16Regular aria-hidden="true" />
          </button>
        )}
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

const connectionReason = {
  M365_OAUTH_DENIED: "Microsoft 365 access was not granted. You can try again when you’re ready.",
  M365_OAUTH_STATE_INVALID: "That connection attempt expired or was already used. Please start again.",
  M365_OAUTH_STATE_EXPIRED: "That connection attempt expired. Please start again.",
  M365_OAUTH_IDENTITY_MISMATCH: "That connection attempt belongs to another signed-in user.",
  M365_TOKEN_EXCHANGE_FAILED: "Microsoft 365 could not complete the connection. Please try again.",
};

function ConnectionsScreen({ connection, loading, busy, error, onConnect, onDisconnect }) {
  const connected = connection?.state === "connected";
  const expired = connection?.state === "expired";
  const connectedAt = connection?.connectedAt
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(connection.connectedAt))
    : null;
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
              <p>Outlook Mail, Calendar, and OneDrive</p>
            </div>
            <span className={`connection-status ${connected ? "connected" : expired ? "expired" : "disconnected"}`}>
              {loading ? "Checking" : connected ? "Connected" : expired ? "Reconnect required" : "Not connected"}
            </span>
          </div>
          <p className="connection-description">Use the approved read-only Microsoft 365 tools through the ONEComputer AI gateway.</p>
          <div className="connection-services" aria-label="Included services">
            <span>Outlook Mail</span><span>Calendar</span><span>OneDrive</span>
          </div>
          {connectedAt && <p className="connection-metadata">Connected {connectedAt}</p>}
        </div>
        <div className="connection-actions">
          {connected ? (
            <button className="secondary-button" type="button" onClick={onDisconnect} disabled={busy || loading}>
              {busy ? "Disconnecting" : "Disconnect"}
            </button>
          ) : (
            <button className="primary-button" type="button" onClick={onConnect} disabled={busy || loading}>
              <PlugConnected24Regular aria-hidden="true" />
              {busy ? "Opening Microsoft" : expired ? "Reconnect" : "Connect Microsoft 365"}
            </button>
          )}
        </div>
      </section>

      <div className="connection-privacy-note"><ShieldCheckmark24Regular aria-hidden="true" /><p>OAuth tokens stay encrypted in the LiteLLM MCP gateway. ONEComputer shows connection status only, and the workspace never receives the token.</p></div>
    </div>
  );
}

export function App() {
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
  const [operationBusy, setOperationBusy] = useState(false);
  const [m365Connection, setM365Connection] = useState(null);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [connectionError, setConnectionError] = useState("");

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

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
    workspaceApi.current().then(applyWorkspace).catch((error) => {
      if (error.code === "WORKSPACE_NOT_FOUND") applyWorkspace(null);
      else { setWorkspaceState("failed"); showApiError(error); }
    });
    operationApi.recent().then(setOperation).catch(showApiError);
    connectionApi.microsoft365()
      .then(setM365Connection)
      .catch((error) => setConnectionError(error.message))
      .finally(() => setConnectionLoading(false));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("view") !== "connections") return;
    setActiveNav("Connections");
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
  }, []);

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
      if (sessionWindow) sessionWindow.location.replace(result.launch.launchUrl);
      else window.location.assign(result.launch.launchUrl);
      setToast("Workspace opened in a secure window.");
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
    if (!window.confirm("Delete this stopped workspace record? You can create a new workspace later.")) return;
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

  const connectMicrosoft365 = () => {
    setConnectionBusy(true);
    setConnectionError("");
    window.location.assign(connectionApi.microsoft365AuthorizeUrl);
  };

  const disconnectMicrosoft365 = async () => {
    if (!window.confirm("Disconnect Microsoft 365 from this ONEComputer user? Your Microsoft account and data will not be deleted.")) return;
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

  const selectNav = (name) => {
    setActiveNav(name);
    setMobileNavOpen(false);
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar${mobileNavOpen ? " mobile-open" : ""}`}>
        <div className="brand" aria-label="ONEComputer">
          <strong>ONE</strong><span>Computer</span>
        </div>
        <nav aria-label="Primary navigation">
          <NavButton active={activeNav === "Home"} icon={activeNav === "Home" ? Home24Filled : Home24Regular} label="Home" onClick={() => selectNav("Home")} />
          <NavButton active={activeNav === "Activity"} icon={Clock24Regular} label="Activity" onClick={() => selectNav("Activity")} />
          <NavButton active={activeNav === "Connections"} icon={PlugConnected24Regular} label="Connections" onClick={() => selectNav("Connections")} />
          <ExternalNavLink icon={Bot24Regular} label="Gateway" href={gatewayAdminUrl} />
          <NavButton active={activeNav === "Help"} icon={QuestionCircle24Regular} label="Help" onClick={() => selectNav("Help")} />
        </nav>
        <div className="sidebar-profile">
          <Person24Regular aria-hidden="true" />
          <span><strong>Alex Morgan</strong><small>Acme Corporation</small></span>
          <ChevronDown16Regular aria-hidden="true" />
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu" type="button" aria-label="Open navigation" onClick={() => setMobileNavOpen((value) => !value)}>
            <Navigation24Regular aria-hidden="true" />
          </button>
          <div className="mobile-brand"><strong>ONE</strong><span>Computer</span></div>
          <div className="topbar-spacer" />
          <time dateTime="2026-07-19">July 19, 2026</time>
          <span className="topbar-divider" />
          <button className="account-button" type="button" onClick={() => setProfileOpen((value) => !value)} aria-expanded={profileOpen}>
            <span>AM</span>
            <ChevronDown16Regular aria-hidden="true" />
          </button>
          {profileOpen && (
            <div className="profile-menu">
              <strong>Alex Morgan</strong>
              <span>alex.morgan@acme.example</span>
              <button type="button" onClick={() => { setProfileOpen(false); setToast("Profile settings are ready for the next product slice."); }}>Profile settings</button>
            </div>
          )}
        </header>

        {activeNav === "Home" && (
          <HomeScreen
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
        {activeNav === "Activity" && <ActivityScreen operation={operation} onOpenOperation={() => setDrawer("request")} />}
        {activeNav === "Connections" && (
          <ConnectionsScreen
            connection={m365Connection}
            loading={connectionLoading}
            busy={connectionBusy}
            error={connectionError}
            onConnect={connectMicrosoft365}
            onDisconnect={disconnectMicrosoft365}
          />
        )}
        {activeNav === "Help" && <HelpScreen />}
      </main>

      {mobileNavOpen && <button className="mobile-scrim" type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}

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
            <div><dt>Requested by</dt><dd>Alex Morgan</dd></div>
            <div><dt>Operation binding</dt><dd><code>{operation.operationDigest.slice(0, 12)}…</code></dd></div>
          </dl>
          {operation.receipt && (
            <div className="gateway-response">
              <strong>Execution receipt</strong>
              <p>{operation.receipt.resultSummary}</p>
            </div>
          )}
          <div className="drawer-note"><ShieldCheckmark24Regular aria-hidden="true" /><p>{
            operation.state === "approval_required"
              ? "The exact action is stored and bound to this request. The tool has not run. Use the temporary local fixture below to test approval or denial."
              : operation.state === "succeeded"
                ? "The bound operation was approved, executed once, and recorded with a receipt."
                : operation.state === "denied"
                  ? "The request was denied and the tool was not called."
                  : "ONEComputer is preserving the authoritative operation state."
          }</p></div>
          {operation.state === "approval_required" ? (
            <div className="approval-actions">
              <button className="primary-button" type="button" onClick={() => decideGovernedOperation("approve")} disabled={operationBusy}>
                <ShieldCheckmark24Regular aria-hidden="true" />{operationBusy ? "Applying decision" : "Approve with local fixture"}
              </button>
              <button className="secondary-button danger-button" type="button" onClick={() => decideGovernedOperation("deny")} disabled={operationBusy}>Deny</button>
            </div>
          ) : (
            <button className="secondary-button full-width" type="button" onClick={() => setDrawer(null)}>Close</button>
          )}
        </Drawer>
      )}

      {drawer === "gateway" && gatewayResult && (
        <Drawer title="AI connection" onClose={() => setDrawer(null)}>
          <div className="gateway-result-status"><CheckmarkCircle24Regular aria-hidden="true" /><span><strong>Connected through LiteLLM</strong><small>Scoped to this managed workspace</small></span></div>
          <dl className="request-details">
            <div><dt>Base API URL</dt><dd><code>{gatewayResult.apiBaseUrl}</code></dd></div>
            <div><dt>MCP gateway</dt><dd><code>{gatewayResult.mcpUrl}</code></dd></div>
            <div><dt>Model route</dt><dd>{gatewayResult.model}</dd></div>
            <div><dt>Assigned tools</dt><dd>{gatewayResult.tools.map((tool) => tool.name).join(", ") || "None"}</dd></div>
          </dl>
          <div className="gateway-response">
            <strong>Test response</strong>
            <p>{gatewayResult.response}</p>
          </div>
          <div className="drawer-note"><ShieldCheckmark24Regular aria-hidden="true" /><p>The workspace used a short-lived key. Provider and LiteLLM administrator credentials were not shared with it.</p></div>
          <button className="secondary-button full-width" type="button" onClick={() => setDrawer(null)}>Close</button>
        </Drawer>
      )}

      {toast && <div className="toast" role="status" aria-live="polite"><CheckmarkCircle24Regular aria-hidden="true" />{toast}</div>}
    </div>
  );
}
