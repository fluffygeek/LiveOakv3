import { useState } from "react";
import { ActivityIndicator, Button, StyleSheet, Text, View } from "react-native";
import { AccessDeniedScreen } from "./src/auth/AccessDeniedScreen";
import { SignInScreen } from "./src/auth/SignInScreen";
import { useAuth } from "./src/auth/useAuth";
import { SubmitJobScreen } from "./src/jobRecords/SubmitJobScreen";
import { useJobRecordSync } from "./src/jobRecords/useJobRecordSync";
import { WeeklyListScreen } from "./src/jobRecords/WeeklyListScreen";

type Tab = "submit" | "myWeek";

export default function App() {
  const { state, signIn, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>("submit");
  // Runs at the App level (not inside SubmitJobScreen) so queued offline
  // submissions keep retrying on reconnect/foreground even while the
  // Technician is on the "My Week" tab instead of "Submit".
  useJobRecordSync();

  if (state.status === "loading") {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  if (state.status === "signedOut") {
    return <SignInScreen onSignIn={signIn} />;
  }

  if (state.status === "denied") {
    return <AccessDeniedScreen onSignOut={() => void signOut()} />;
  }

  if (!state.access.roles.includes("technician")) {
    return (
      <View style={styles.container}>
        <Text>Signed in as {state.access.email}</Text>
        <Text>Roles: {state.access.roles.join(", ")}</Text>
        <Text>No Technician role on this account — nothing to do here yet.</Text>
        <Button title="Sign out" onPress={() => void signOut()} />
      </View>
    );
  }

  return (
    <View style={styles.flexContainer}>
      <View style={styles.header}>
        <Text>{state.access.email}</Text>
        <Button title="Sign out" onPress={() => void signOut()} />
      </View>
      <View style={styles.tabBar}>
        <Button title="Submit" onPress={() => setTab("submit")} disabled={tab === "submit"} />
        <Button title="My Week" onPress={() => setTab("myWeek")} disabled={tab === "myWeek"} />
      </View>
      {tab === "submit" ? <SubmitJobScreen /> : <WeeklyListScreen />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  flexContainer: {
    flex: 1,
    paddingTop: 48,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  tabBar: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
    paddingBottom: 8,
  },
});
