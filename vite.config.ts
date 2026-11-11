import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  base: process.env.GITHUB_PAGES === "true" ? "/HR_system/" : "/",
  envPrefix: ["VITE_", "EXPO_PUBLIC_"],
  plugins: [react()],
})
