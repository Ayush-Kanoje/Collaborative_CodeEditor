import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MonacoBinding } from "y-monaco";
import * as Y from "yjs";
import { SocketIOProvider } from "y-socket.io";

export function useCollaboration({ username, sessionId, selectedUser, getPersonalCodeRoom, getUserId }) {
  const [editor, setEditor] = useState(null);
  const [isCodeDocumentReady, setIsCodeDocumentReady] = useState(false);
  const [isViewedCodeDocumentReady, setIsViewedCodeDocumentReady] = useState(false);
  const bindingRef = useRef(null);

  const destroyBinding = useCallback((bindingRecord = bindingRef.current) => {
    if (!bindingRecord || bindingRecord.destroyed) return;
    bindingRecord.destroyed = true;
    if (bindingRef.current === bindingRecord) bindingRef.current = null;
    const modelDisposed = bindingRecord.model?.isDisposed?.() ?? false;
    bindingRecord.modelDisposeSubscription?.dispose();
    if (!modelDisposed) bindingRecord.binding.destroy();
  }, []);

  const personalDocument = useMemo(() => (username ? new Y.Doc() : null), [username]);
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
  const activeWorkspaceId = isViewing ? selectedUser.userId : getUserId(username);
  const isDocumentReady = isViewing ? isViewedCodeDocumentReady : isCodeDocumentReady;

  useEffect(() => {
    if (!personalDocument || !username) {
      setIsCodeDocumentReady(false);
      return undefined;
    }
    setIsCodeDocumentReady(false);
    const provider = new SocketIOProvider("/", getPersonalCodeRoom(username), personalDocument, {
      autoConnect: false,
      disableBc: true,
      auth: { username, sessionId, access: "owner" },
    });
    const handleSync = (synced) => synced && setIsCodeDocumentReady(true);
    provider.on("sync", handleSync);
    provider.connect();
    return () => {
      destroyBinding();
      provider.off("sync", handleSync);
      provider.destroy();
    };
  }, [destroyBinding, getPersonalCodeRoom, personalDocument, sessionId, username]);

  useEffect(() => {
    if (!viewedDocument || !selectedUser || !username) {
      setIsViewedCodeDocumentReady(false);
      return undefined;
    }
    setIsViewedCodeDocumentReady(false);
    const provider = new SocketIOProvider("/", getPersonalCodeRoom(selectedUser.userId), viewedDocument, {
      autoConnect: false,
      disableBc: true,
      auth: { username, sessionId, access: "view" },
    });
    const handleSync = (synced) => synced && setIsViewedCodeDocumentReady(true);
    provider.on("sync", handleSync);
    provider.connect();
    return () => {
      destroyBinding();
      provider.off("sync", handleSync);
      provider.destroy();
    };
  }, [destroyBinding, getPersonalCodeRoom, selectedUser, sessionId, username, viewedDocument]);

  const handleEditorMount = useCallback((instance) => {
    if (!instance || instance.isDisposed?.()) return;
    const model = instance.getModel?.();
    if (!model || model.isDisposed?.()) return;
    setEditor(instance);
  }, []);
  const handleEditorUnmount = useCallback(() => setEditor(null), []);

  useEffect(() => {
    if (!editor || !activeText || !isDocumentReady) return undefined;
    if (editor.isDisposed?.()) return undefined;
    const model = editor.getModel?.();
    if (!model || model.isDisposed?.()) return undefined;
    destroyBinding();
    if (editor.isDisposed?.() || editor.getModel?.() !== model || model.isDisposed?.()) return undefined;
    const bindingRecord = {
      binding: new MonacoBinding(activeText, model, new Set([editor])),
      model,
      destroyed: false,
      modelDisposeSubscription: null,
    };
    bindingRecord.modelDisposeSubscription = model.onWillDispose(() => {
      bindingRecord.destroyed = true;
      if (bindingRef.current === bindingRecord) bindingRef.current = null;
    });
    bindingRef.current = bindingRecord;
    return () => destroyBinding(bindingRecord);
  }, [activeText, activeWorkspaceId, destroyBinding, editor, isDocumentReady]);

  useEffect(() => () => destroyBinding(), [destroyBinding]);

  const getEditorContent = useCallback(() => editor?.getModel?.()?.getValue?.() || "", [editor]);
  const resetEditorForWorkspaceChange = useCallback(() => {
    destroyBinding();
    setEditor(null);
    setIsViewedCodeDocumentReady(false);
  }, [destroyBinding]);

  return { isViewing, isDocumentReady, getEditorContent, handleEditorMount, handleEditorUnmount, resetEditorForWorkspaceChange };
}
