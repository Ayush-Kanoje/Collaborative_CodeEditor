import { useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import { SocketIOProvider } from "y-socket.io";

const PRESENCE_ROOM = "collaborator-presence-v1";

function getCollaborators(awareness, getUserId) {
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

export function usePresence({ username, sessionId, getUserId }) {
  const [users, setUsers] = useState([]);
  const presenceDocument = useMemo(() => (username ? new Y.Doc() : null), [username]);

  useEffect(() => {
    if (!presenceDocument || !username) {
      setUsers([]);
      return undefined;
    }
    const provider = new SocketIOProvider("/", PRESENCE_ROOM, presenceDocument, {
      autoConnect: false,
      disableBc: true,
      auth: { username, sessionId, access: "presence" },
    });
    const updateUsers = () => setUsers(getCollaborators(provider.awareness, getUserId));
    provider.awareness.setLocalStateField("user", { username, sessionId });
    provider.awareness.on("change", updateUsers);
    provider.connect();
    updateUsers();
    return () => {
      provider.awareness.setLocalStateField("user", null);
      provider.awareness.off("change", updateUsers);
      provider.destroy();
    };
  }, [getUserId, presenceDocument, sessionId, username]);

  return users;
}
