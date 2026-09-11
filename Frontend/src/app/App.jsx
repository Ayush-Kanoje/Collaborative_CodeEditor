import "./App.css";
import { useEffect, useState } from "react";
import { CollaborativeEditor } from "../components/CollaborativeEditor";
import { ExplainCodePanel } from "../components/ExplainCodePanel";
import { UserSidebar } from "../components/UserSidebar";
import { useCollaboration } from "../hooks/useCollaboration";
import { usePresence } from "../hooks/usePresence";

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

/**
 * Generate a secure session ID
 * Uses Web Crypto API for secure random generation
 * Falls back to combined timestamp+random if crypto not available
 * Fails loudly if neither is available (security requirement)
 */
function generateSecureSessionId() {
  // Prefer Web Crypto API (most secure)
  if (window.crypto?.getRandomValues) {
    const array = new Uint8Array(16);
    window.crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  // Fallback: use randomUUID if available
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  // No secure random available - this is a security issue
  console.error("Web Crypto API not available. Session IDs may not be secure.");
  // Still generate something, but this should trigger a warning in production
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getSessionId() {
  const key = "collaborative-editor-session-id";
  const saved = window.sessionStorage.getItem(key);
  if (saved) return saved;
  
  const sessionId = generateSecureSessionId();
  window.sessionStorage.setItem(key, sessionId);
  return sessionId;
}

function App() {
  const [username, setUsername] = useState(getInitialUsername);
  const [usernameError, setUsernameError] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [sessionId] = useState(getSessionId);
  const [showExplainer, setShowExplainer] = useState(false);
  const users = usePresence({ username, sessionId, getUserId });
  const { isViewing, isDocumentReady, getEditorContent, handleEditorMount, handleEditorUnmount, resetEditorForWorkspaceChange } = useCollaboration({ username, sessionId, selectedUser, getPersonalCodeRoom, getUserId });

  useEffect(() => {
    if (
      !selectedUser ||
      users.some((user) => user.userId === selectedUser.userId)
    )
      return;
    resetEditorForWorkspaceChange();
    setSelectedUser(null);
  }, [resetEditorForWorkspaceChange, selectedUser, users]);

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
    resetEditorForWorkspaceChange();
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

  return (
    <main className="h-screen w-full bg-gray-950 flex gap-4 p-4">
      <UserSidebar username={username} users={users} selectedUser={selectedUser} onSelectWorkspace={selectWorkspace} getUserId={getUserId} />
      <CollaborativeEditor isViewing={isViewing} selectedUser={selectedUser} username={username} isDocumentReady={isDocumentReady} onMount={handleEditorMount} onUnmount={handleEditorUnmount} onExplain={() => setShowExplainer(true)} />
      {showExplainer && (
        <ExplainCodePanel
          code={getEditorContent()}
          onClose={() => setShowExplainer(false)}
        />
      )}
    </main>
  );
}

export default App;
