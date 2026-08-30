import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from "@tailwindcss/vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [ react(), tailwindcss() ],
  server: {
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
      '/execute': {
        target: 'http://localhost:3000',
      },
    },
  },
})
