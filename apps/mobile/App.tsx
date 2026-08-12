import { ActivityIndicator, Button, StyleSheet, Text, View } from "react-native";
import { AccessDeniedScreen } from "./src/auth/AccessDeniedScreen";
import { SignInScreen } from "./src/auth/SignInScreen";
import { useAuth } from "./src/auth/useAuth";
import { SubmitJobScreen } from "./src/jobRecords/SubmitJobScreen";

export default function App() {
  const { state, signIn, signOut } = useAuth();

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
      <SubmitJobScreen />
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
});
