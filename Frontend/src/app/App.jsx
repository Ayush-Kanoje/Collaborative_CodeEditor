import "./App.css"
import { Editor } from "@monaco-editor/react"
import { useMemo, useRef } from "react"
import * as Y from "yjs"
import { SocketIOProvider } from "y-socket.io"


function App() {
  const ydoc = useMemo(() => new Y.Doc(), [])
  const yText = useMemo(() => ydoc.getText("monaco"), [ydoc])
  const editorRef = useRef(null)
  const providerRef = useRef(null)

  const handleMount = (editor) => {
    editorRef.current = editor

    // Initialize Socket.IO provider
    providerRef.current = new SocketIOProvider("http://localhost:3000", "my-room-1", ydoc, {
      autoConnect: true,
    })

    let isRemoteChange = false

    // Listen to Yjs changes and update Monaco with proper delta handling
    yText.observe((event) => {
      if (isRemoteChange) return

      isRemoteChange = true
      const model = editor.getModel()
      let index = 0

      event.delta.forEach((change) => {
        if (change.retain !== undefined) {
          index += change.retain
        } else if (change.insert !== undefined) {
          const pos = model.getPositionAt(index)
          const text = typeof change.insert === 'string' ? change.insert : ''
          model.applyEdits([{
            range: {
              startLineNumber: pos.lineNumber,
              startColumn: pos.column,
              endLineNumber: pos.lineNumber,
              endColumn: pos.column
            },
            text: text
          }])
          index += text.length
        } else if (change.delete !== undefined) {
          const startPos = model.getPositionAt(index)
          const endPos = model.getPositionAt(index + change.delete)
          model.applyEdits([{
            range: {
              startLineNumber: startPos.lineNumber,
              startColumn: startPos.column,
              endLineNumber: endPos.lineNumber,
              endColumn: endPos.column
            },
            text: ''
          }])
        }
      })

      isRemoteChange = false
    })

    // Listen to Monaco changes and update Yjs
    editor.onDidChangeModelContent((event) => {
      if (isRemoteChange) return
      
      isRemoteChange = true
      const model = editor.getModel()

      event.changes.forEach((change) => {
        const offset = model.getOffsetAt({
          lineNumber: change.range.startLineNumber,
          column: change.range.startColumn
        })

        const endOffset = model.getOffsetAt({
          lineNumber: change.range.endLineNumber,
          column: change.range.endColumn
        })

        const deleteLength = endOffset - offset

        // Apply deletion first if needed
        if (deleteLength > 0) {
          yText.delete(offset, deleteLength)
        }

        // Then apply insertion if there's text
        if (change.text) {
          yText.insert(offset, change.text)
        }
      })

      isRemoteChange = false
    })
  }
 
  return (
    <main className="h-screen w-full bg-gray-950 flex gap-4 p-4">
      <aside className="h-full w-1/4 bg-amber-50 rounded-lg ">
      </aside>
      <section className="w-3/4 bg-neutral-800 rounded-lg overflow-hidden">
        <Editor
          height="95%"
          defaultLanguage="javascript"
          defaultValue="// some comment"
          theme="vs-dark"
          onMount={handleMount}
        />
      </section>
    </main>
  )
}

export default App
