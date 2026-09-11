export function EditorHeader({ isViewing, selectedUser, username, onExplain }) {
  return <header className="bg-neutral-900 px-4 py-2 text-sm text-gray-300 border-b border-neutral-700 flex items-center justify-between gap-4">
    <span>{isViewing ? `${selectedUser.username}${"'"}s code (read-only)` : `Your private editor — ${username}`}</span>
    <button onClick={onExplain} className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded text-xs font-semibold transition-colors">Explain Code</button>
  </header>;
}
