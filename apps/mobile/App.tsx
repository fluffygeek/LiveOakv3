import { ActivityIndicator, Button, StyleSheet, Text, View } from "react-native";
import { AccessDeniedScreen } from "./src/auth/AccessDeniedScreen";
import { SignInScreen } from "./src/auth/SignInScreen";
import { useAuth } from "./src/auth/useAuth";

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

  return (
    <View style={styles.container}>
      <Text>Signed in as {state.access.email}</Text>
      <Text>Roles: {state.access.roles.join(", ")}</Text>
      <Button title="Sign out" onPress={() => void signOut()} />
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
});
