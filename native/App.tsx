import { StatusBar } from "expo-status-bar"
import { useEffect, useState } from "react"
import { Linking, StyleSheet } from "react-native"
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context"
import { checkinPathFromUrl } from "../src/lib/checkinLink.ts"
import WebApp from "../src/WebApp.tsx"

export default function App() {
  const [entryPath, setEntryPath] = useState("")
  const [entrySeq, setEntrySeq] = useState(0)

  useEffect(() => {
    let seq = 0
    let lastUrl = ""
    let lastAt = 0
    const apply = (url: string | null) => {
      if (!url) return
      const path = checkinPathFromUrl(url)
      if (!path) return
      const now = Date.now()
      if (url === lastUrl && now - lastAt < 1500) return
      lastUrl = url
      lastAt = now
      seq += 1
      setEntryPath(path)
      setEntrySeq(seq)
    }
    void Linking.getInitialURL().then(apply)
    const subscription = Linking.addEventListener("url", (event) => apply(event.url))
    return () => subscription.remove()
  }, [])

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={styles.root}>
        <WebApp dom={{ style: styles.web }} entryPath={entryPath} entrySeq={entrySeq} />
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#101428",
  },
  web: {
    flex: 1,
  },
})
