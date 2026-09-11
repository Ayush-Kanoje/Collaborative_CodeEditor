import { Editor } from "@monaco-editor/react";
import { EditorHeader } from "./EditorHeader";

export function CollaborativeEditor({ isViewing, selectedUser, username, isDocumentReady, onMount, onUnmount, onExplain }) {
  return <section className="w-3/4 bg-neutral-800 rounded-lg overflow-hidden flex flex-col min-h-0">
    <EditorHeader isViewing={isViewing} selectedUser={selectedUser} username={username} onExplain={onExplain} />
    <div className="flex-1 min-h-0">
      {isDocumentReady ? <Editor key={isViewing ? `view-${selectedUser.userId}` : "personal"} height="100%" defaultLanguage="python" theme="vs-dark" onMount={onMount} onUnmount={onUnmount} options={{ readOnly: isViewing, domReadOnly: isViewing }} /> :
        <div className="h-full flex items-center justify-center text-gray-300">Loading {isViewing ? `${selectedUser.username}${"'"}s code` : "your personal workspace"}…</div>}
    </div>
  </section>;
}
