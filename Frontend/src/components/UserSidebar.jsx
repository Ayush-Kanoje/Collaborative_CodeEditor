export function UserSidebar({ username, users, selectedUser, onSelectWorkspace, getUserId }) {
  const otherUsers = users.filter((user) => user.userId !== getUserId(username));
  return <aside className="h-full w-1/4 bg-amber-50 rounded-lg overflow-auto">
    <h2 className="text-2xl font-bold p-4 border-b border-gray-300">Users</h2>
    <ul className="p-4 space-y-2">
      <li><button onClick={() => onSelectWorkspace(null)} className={`w-full p-2 rounded text-left ${!selectedUser ? "bg-gray-800 text-white" : "bg-white text-gray-900"}`}>Your code ({username})</button></li>
      {otherUsers.map((user) => <li key={user.sessionId}><button onClick={() => onSelectWorkspace(user)} className={`w-full p-2 rounded text-left ${selectedUser?.userId === user.userId ? "bg-gray-800 text-white" : "bg-white text-gray-900"}`}>View {user.username}</button></li>)}
      {!otherUsers.length && <li className="text-sm text-gray-600">No other users connected.</li>}
    </ul>
  </aside>;
}
