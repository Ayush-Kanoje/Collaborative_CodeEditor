import "./App.css";
import { Editor } from "@monaco-editor/react";
import { MonacoBinding } from "y-monaco";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { SocketIOProvider } from "y-socket.io";

const PRESENCE_ROOM = "collaborator-presence-v1";
const USERNAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u;

function normalizeUsername(value) {
  const username = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  return USERNAME_PATTERN.test(username) ? username : "";
}

function getPersonalCodeRoom(username) {
  return `personal-code-v1:${encodeURIComponent(username.toLowerCase())}`;
}

function getUserId(username) {
  return normalizeUsername(username).toLowerCase();
}

function getInitialUsername() {
  return normalizeUsername(
    new URLSearchParams(window.location.search).get("username") || "",
  );
}

function getSessionId() {
  const key = "collaborative-editor-session-id";
  const saved = window.sessionStorage.getItem(key);
  if (saved) return saved;
  const sessionId =
    window.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  window.sessionStorage.setItem(key, sessionId);
  return sessionId;
}

function getCollaborators(awareness) {
  const collaborators = new Map();
  awareness.getStates().forEach((state) => {
    if (state.user?.username && state.user?.sessionId) {
      collaborators.set(state.user.sessionId, {
        ...state.user,
        userId: state.user.userId || getUserId(state.user.username),
      });
    }
  });
  return [...collaborators.values()].sort((a, b) =>
    a.username.localeCompare(b.username),
  );
}

function App() {
  const [username, setUsername] = useState(getInitialUsername);
  const [usernameError, setUsernameError] = useState("");
  const [users, setUsers] = useState([]);
  const [editor, setEditor] = useState(null);
  const [isCodeDocumentReady, setIsCodeDocumentReady] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [isViewedCodeDocumentReady, setIsViewedCodeDocumentReady] =
    useState(false);
  const [sessionId] = useState(getSessionId);
  const [executionStatus, setExecutionStatus] = useState("idle");
  const [executionResult, setExecutionResult] = useState(null);
  const bindingRef = useRef(null);

  const destroyBinding = useCallback((bindingRecord = bindingRef.current) => {
    if (!bindingRecord || bindingRecord.destroyed) return;
    bindingRecord.destroyed = true;
    if (bindingRef.current === bindingRecord) bindingRef.current = null;

    // MonacoBinding already destroys itself from the model's onWillDispose
    // callback. Do not call destroy() again after the model has gone away;
    // y-monaco's second unobserve() emits the Yjs warning shown in the console.
    const modelDisposed = bindingRecord.model?.isDisposed?.() ?? false;
    bindingRecord.modelDisposeSubscription?.dispose();
    if (!modelDisposed) bindingRecord.binding.destroy();
  }, []);

  const personalDocument = useMemo(
    () => (username ? new Y.Doc() : null),
    [username],
  );
  const presenceDocument = useMemo(
    () => (username ? new Y.Doc() : null),
    [username],
  );
  const personalText = useMemo(
    () => personalDocument?.getText("monaco") || null,
    [personalDocument],
  );
  const viewedDocument = useMemo(
    () => (selectedUser ? new Y.Doc() : null),
    [selectedUser],
  );
  const viewedText = useMemo(
    () => viewedDocument?.getText("monaco") || null,
    [viewedDocument],
  );
  const isViewing = Boolean(selectedUser);
  const activeText = isViewing ? viewedText : personalText;
  const activeWorkspaceId = isViewing
    ? selectedUser.userId
    : getUserId(username);
  const isDocumentReady = isViewing
    ? isViewedCodeDocumentReady
    : isCodeDocumentReady;
  const isExecuting = executionStatus === "running";

  useEffect(() => {
    if (!personalDocument || !username) {
      setIsCodeDocumentReady(false);
      return undefined;
    }
    setIsCodeDocumentReady(false);
    const provider = new SocketIOProvider(
      "/",
      getPersonalCodeRoom(username),
      personalDocument,
      {
        autoConnect: false,
        disableBc: true,
        auth: { username, sessionId, access: "owner" },
      },
    );
    const handleSync = (synced) => synced && setIsCodeDocumentReady(true);
    provider.on("sync", handleSync);
    provider.connect();
    return () => {
      // Provider teardown may remove Yjs observers. Dispose the binding first.
      destroyBinding();
      provider.off("sync", handleSync);
      provider.destroy();
    };
  }, [destroyBinding, personalDocument, sessionId, username]);

  useEffect(() => {
    if (!viewedDocument || !selectedUser || !username) {
      setIsViewedCodeDocumentReady(false);
      return undefined;
    }
    setIsViewedCodeDocumentReady(false);
    const provider = new SocketIOProvider(
      "/",
      getPersonalCodeRoom(selectedUser.userId),
      viewedDocument,
      {
        autoConnect: false,
        disableBc: true,
        auth: { username, sessionId, access: "view" },
      },
    );
    const handleSync = (synced) => synced && setIsViewedCodeDocumentReady(true);
    provider.on("sync", handleSync);
    provider.connect();
    return () => {
      // Provider teardown may remove Yjs observers. Dispose the binding first.
      destroyBinding();
      provider.off("sync", handleSync);
      provider.destroy();
    };
  }, [destroyBinding, selectedUser, sessionId, username, viewedDocument]);

  useEffect(() => {
    if (!presenceDocument || !username) {
      setUsers([]);
      return undefined;
    }
    const provider = new SocketIOProvider(
      "/",
      PRESENCE_ROOM,
      presenceDocument,
      {
        autoConnect: false,
        disableBc: true,
        auth: { username, sessionId, access: "presence" },
      },
    );
    const updateUsers = () => setUsers(getCollaborators(provider.awareness));
    provider.awareness.setLocalStateField("user", { username, sessionId });
    provider.awareness.on("change", updateUsers);
    provider.connect();
    updateUsers();
    return () => {
      provider.awareness.setLocalStateField("user", null);
      provider.awareness.off("change", updateUsers);
      provider.destroy();
    };
  }, [presenceDocument, sessionId, username]);

  const handleEditorMount = useCallback((instance) => {
    if (!instance || instance.isDisposed?.()) return;
    const model = instance.getModel?.();
    if (!model || model.isDisposed?.()) return;
    setEditor(instance);
  }, []);

  const handleEditorUnmount = useCallback(() => {
    setEditor(null);
  }, []);

  useEffect(() => {
    if (
      !selectedUser ||
      users.some((user) => user.userId === selectedUser.userId)
    )
      return;
    destroyBinding();
    setEditor(null);
    setIsViewedCodeDocumentReady(false);
    setSelectedUser(null);
  }, [destroyBinding, selectedUser, users]);

  useEffect(() => {
    if (!editor || !activeText || !isDocumentReady) return undefined;

    if (editor.isDisposed?.()) return undefined;
    const model = editor.getModel?.();
    if (!model || model.isDisposed?.()) return undefined;

    destroyBinding();
    // Re-check after disposing the previous binding. This keeps a stale
    // editor/model pair from reaching MonacoBinding during a keyed remount.
    if (
      editor.isDisposed?.() ||
      editor.getModel?.() !== model ||
      model.isDisposed?.()
    )
      return undefined;

    const bindingRecord = {
      binding: new MonacoBinding(activeText, model, new Set([editor])),
      model,
      destroyed: false,
      modelDisposeSubscription: null,
    };
    // MonacoBinding also destroys itself when this model is disposed. Mark the
    // record as closed at that point so React's later effect cleanup cannot
    // call its Yjs unobserve/off cleanup a second time.
    bindingRecord.modelDisposeSubscription = model.onWillDispose(() => {
      bindingRecord.destroyed = true;
      if (bindingRef.current === bindingRecord) bindingRef.current = null;
    });
    bindingRef.current = bindingRecord;
    return () => destroyBinding(bindingRecord);
  }, [activeText, activeWorkspaceId, destroyBinding, editor, isDocumentReady]);

  useEffect(() => () => destroyBinding(), [destroyBinding]);

  const handleExecute = useCallback(async () => {
    if (isExecuting || isViewing || !personalText) return;
    setExecutionStatus("running");
    setExecutionResult(null);
    try {
      const response = await fetch("/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: personalText.toString(), username }),
      });
      const result = await response
        .json()
        .catch(() => ({
          status: "failed",
          error: "The execution service returned an invalid response.",
        }));
      setExecutionResult(result);
      setExecutionStatus(
        result.status || (response.ok ? "completed" : "failed"),
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to reach the execution service.";
      setExecutionResult({ status: "failed", error: message });
      setExecutionStatus("failed");
    }
  }, [isExecuting, isViewing, personalText, username]);

  const handleJoin = (event) => {
    event.preventDefault();
    const nextUsername = normalizeUsername(
      new FormData(event.currentTarget).get("username")?.toString() || "",
    );
    if (!nextUsername) {
      setUsernameError(
        "Use 1-40 letters, numbers, spaces, dots, hyphens, or underscores.",
      );
      return;
    }
    setUsernameError("");
    setUsername(nextUsername);
    window.history.pushState(
      {},
      "",
      `?username=${encodeURIComponent(nextUsername)}`,
    );
  };

  const selectWorkspace = (user) => {
    // Tear down before changing documents so bindings cannot overlap.
    destroyBinding();
    setEditor(null);
    setIsViewedCodeDocumentReady(false);
    setSelectedUser(user);
  };

  if (!username)
    return (
      <main className="h-screen w-full bg-gray-950 flex gap-4 p-4 items-center justify-center">
        <form onSubmit={handleJoin} className="flex flex-col gap-4" noValidate>
          <input
            type="text"
            placeholder="Enter your username"
            className="p-2 rounded-lg bg-gray-800 text-white"
            name="username"
            maxLength="40"
            autoComplete="username"
            aria-describedby={usernameError ? "username-error" : undefined}
          />
          {usernameError && (
            <p id="username-error" className="text-red-300 text-sm">
              {usernameError}
            </p>
          )}
          <button className="p-2 rounded-lg bg-amber-50 text-gray-950 font-bold">
            Join
          </button>
        </form>
      </main>
    );

  const otherUsers = users.filter(
    (user) => user.userId !== getUserId(username),
  );
  return (
    <main className="h-screen w-full bg-gray-950 flex gap-4 p-4">
      <aside className="h-full w-1/4 bg-amber-50 rounded-lg overflow-auto">
        <h2 className="text-2xl font-bold p-4 border-b border-gray-300">
          Users
        </h2>
        <ul className="p-4 space-y-2">
          <li>
            <button
              onClick={() => selectWorkspace(null)}
              className={`w-full p-2 rounded text-left ${!selectedUser ? "bg-gray-800 text-white" : "bg-white text-gray-900"}`}
            >
              Your code ({username})
            </button>
          </li>
          {otherUsers.map((user) => (
            <li key={user.sessionId}>
              <button
                onClick={() => selectWorkspace(user)}
                className={`w-full p-2 rounded text-left ${selectedUser?.userId === user.userId ? "bg-gray-800 text-white" : "bg-white text-gray-900"}`}
              >
                View {user.username}
              </button>
            </li>
          ))}
          {!otherUsers.length && (
            <li className="text-sm text-gray-600">No other users connected.</li>
          )}
        </ul>
      </aside>
      <section className="w-3/4 bg-neutral-800 rounded-lg overflow-hidden flex flex-col min-h-0">
        <header className="bg-neutral-900 px-4 py-2 text-sm text-gray-300 border-b border-neutral-700 flex items-center justify-between gap-4">
          <span>
            {isViewing
              ? `${selectedUser.username}'s code (read-only)`
              : `Your private editor — ${username}`}
          </span>
          {!isViewing && (
            <button
              onClick={handleExecute}
              disabled={!isCodeDocumentReady || isExecuting}
              className="px-3 py-1 rounded bg-amber-50 text-gray-950 font-bold disabled:opacity-50"
            >
              {isExecuting ? "Executing…" : "Execute"}
            </button>
          )}
        </header>
        <div className="flex-1 min-h-0">
          {isDocumentReady ? (
            <Editor
              key={isViewing ? `view-${selectedUser.userId}` : "personal"}
              height="100%"
              defaultLanguage="python"
              theme="vs-dark"
              onMount={handleEditorMount}
              onUnmount={handleEditorUnmount}
              options={{ readOnly: isViewing, domReadOnly: isViewing }}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-gray-300">
              Loading{" "}
              {isViewing
                ? `${selectedUser.username}'s code`
                : "your personal workspace"}
              …
            </div>
          )}
        </div>
        {(executionResult || isExecuting) && (
          <section
            className="border-t border-neutral-700 bg-neutral-900 p-3 text-sm text-gray-200 max-h-56 overflow-auto"
            aria-live="polite"
          >
            <div className="font-semibold">
              Output{" "}
              {isExecuting
                ? "(executing…)"
                : `(${executionResult.status || executionStatus})`}
            </div>
            {!isExecuting && (
              <div className="text-gray-400">
                Exit code: {executionResult.exitCode ?? "—"} · Time:{" "}
                {executionResult.durationMs ?? "—"} ms
              </div>
            )}
            {executionResult?.stdout && (
              <pre className="mt-2 whitespace-pre-wrap text-green-200">
                {executionResult.stdout}
              </pre>
            )}
            {executionResult?.stderr && (
              <pre className="mt-2 whitespace-pre-wrap text-red-200">
                {executionResult.stderr}
              </pre>
            )}
            {executionResult?.error && (
              <p className="mt-2 text-red-200">{executionResult.error}</p>
            )}
          </section>
        )}
      </section>
    </main>
  );
}

export default App;
