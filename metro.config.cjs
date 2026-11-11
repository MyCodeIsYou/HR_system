const fs = require("fs")
const path = require("path")
const { getDefaultConfig } = require("expo/metro-config")

function loadEnvFile(file, override) {
  if (!fs.existsSync(file)) return
  const text = fs.readFileSync(file, "utf8")
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (override || process.env[key] === undefined) process.env[key] = value
  }
}

const root = __dirname
loadEnvFile(path.join(root, ".env"), false)
loadEnvFile(path.join(root, ".env.local"), true)
loadEnvFile(path.join(root, ".env.development"), false)
loadEnvFile(path.join(root, ".env.development.local"), true)

if (!process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
  process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.VITE_SUPABASE_URL
}
if (!process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY && process.env.VITE_SUPABASE_ANON_KEY) {
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY
}

const config = getDefaultConfig(root)

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith(".") && /\.tsx?$/.test(moduleName)) {
    return context.resolveRequest(context, moduleName.replace(/\.tsx?$/, ""), platform)
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
