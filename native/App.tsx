import { StatusBar } from "expo-status-bar"
import { StyleSheet } from "react-native"
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context"
import WebApp from "../src/WebApp.tsx"

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={styles.root}>
        <WebApp dom={{ style: styles.web }} />
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
