import fs from "node:fs"
import path from "node:path"
import tailwindcss from "@tailwindcss/postcss"

function inlineLocalFonts() {
  return {
    postcssPlugin: "inline-local-fonts",
    Once(root) {
      root.walkDecls("src", (decl) => {
        const from = decl.source?.input?.from
        if (!from) return
        decl.value = decl.value.replace(/url\((['"]?)(\.[^'")]+)\1\)/g, (match, _quote, rel) => {
          if (!rel.endsWith(".woff") && !rel.endsWith(".woff2")) return match
          const file = path.resolve(path.dirname(from), rel)
          const data = fs.readFileSync(file).toString("base64")
          return `url("data:font/woff;base64,${data}")`
        })
      })
    },
  }
}

export default {
  plugins: [inlineLocalFonts(), tailwindcss()],
}
