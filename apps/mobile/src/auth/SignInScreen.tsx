import { Button, StyleSheet, Text, View } from "react-native";

interface SignInScreenProps {
  onSignIn: () => void;
}

export function SignInScreen({ onSignIn }: SignInScreenProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>LiveOakv3</Text>
      <Text>Sign in with your company Google account.</Text>
      <Button title="Sign in with Google" onPress={onSignIn} />
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
  title: {
    fontSize: 24,
    fontWeight: "600",
  },
});
